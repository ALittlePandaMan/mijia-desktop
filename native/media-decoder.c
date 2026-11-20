/* Isolated, stdin-only preview decoder. MIT. FFmpeg DLLs remain LGPL.
 * No network protocols, filenames, device credentials or control commands.
 * stdout: MJFR, kind:u32, w:u32, h:u32, pts:f64, duration:f64, bytes:u32,
 * rate:u32, followed by RGBA pixels or interleaved stereo float PCM. */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#include <io.h>
#include <fcntl.h>
#include <windows.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libswscale/swscale.h>
#include <libswresample/swresample.h>
#include <libavutil/channel_layout.h>
#include <libavutil/opt.h>

#define INPUT_LIMIT (48u*1024u*1024u)
#define PIXEL_LIMIT (4096u*4096u)
#define SOURCE_LIMIT (3840u*2160u)
typedef struct Input {
 uint8_t *data;
 size_t size, pos;
 uint32_t remaining, width, height;
 uint32_t pressure;
 int file, framed, source_size, low_power;
} Input;

static int read_exact(void *buffer, unsigned length) {
 uint8_t *bytes=buffer;
 while(length){
  int n=_read(_fileno(stdin),bytes,length);
  if(n<=0)return 0;
  bytes+=n;length-=n;
 }
 return 1;
}

static int read_input(void *opaque,uint8_t *buffer,int length){
 Input *in=opaque;
 if(in->file){size_t n=in->size-in->pos;if(n>(size_t)length)n=length;if(!n)return AVERROR_EOF;memcpy(buffer,in->data+in->pos,n);in->pos+=n;return (int)n;}
 if(in->framed){
  /* Control records are consumed between byte ranges and never reach FFmpeg. */
  while(!in->remaining){
   uint32_t size,viewport[2];
   if(!read_exact(&size,sizeof(size)))return AVERROR_EOF;
   if(size==UINT32_MAX){
    if((!in->source_size&&!in->low_power)||!read_exact(&in->pressure,sizeof(in->pressure))||in->pressure>2)return AVERROR_INVALIDDATA;
    continue;
   }
   if(size>256u*1024u)return AVERROR_INVALIDDATA;
   if(size){in->remaining=size;break;}
   if(in->source_size||!read_exact(viewport,sizeof(viewport))||
      !viewport[0]||!viewport[1]||viewport[0]>3840||viewport[1]>3840||
      (uint64_t)viewport[0]*viewport[1]>3840u*2160u)return AVERROR_INVALIDDATA;
   in->width=viewport[0];in->height=viewport[1];
  }
  if((unsigned)length>in->remaining)length=(int)in->remaining;
 }
 /* read(), not fread(): live packets must not wait for a full AVIO buffer. */
 int n=_read(_fileno(stdin),buffer,length);
 if(n>0&&in->framed)in->remaining-=n;
 return n>0?n:AVERROR_EOF;
}
static int64_t seek_input(void *opaque,int64_t offset,int whence){
 Input *in=opaque;if(!in->file)return AVERROR(ENOSYS);if(whence==AVSEEK_SIZE)return in->size;
 int64_t next=whence==SEEK_SET?offset:whence==SEEK_CUR?(int64_t)in->pos+offset:whence==SEEK_END?(int64_t)in->size+offset:-1;
 if(next<0||(uint64_t)next>in->size)return AVERROR(EINVAL);in->pos=(size_t)next;return next;
}
static int output(uint32_t kind,uint32_t w,uint32_t h,double pts,double duration,const void *data,uint32_t bytes,uint32_t rate){
 uint8_t header[40];memcpy(header,"MJFR",4);memcpy(header+4,&kind,4);memcpy(header+8,&w,4);memcpy(header+12,&h,4);
 memcpy(header+16,&pts,8);memcpy(header+24,&duration,8);memcpy(header+32,&bytes,4);memcpy(header+36,&rate,4);
 return fwrite(header,1,40,stdout)==40&&(!bytes||fwrite(data,1,bytes,stdout)==bytes)&&fflush(stdout)==0;
}
static int supported(enum AVCodecID id){return id==AV_CODEC_ID_H264||id==AV_CODEC_ID_HEVC||id==AV_CODEC_ID_AAC||id==AV_CODEC_ID_OPUS||id==AV_CODEC_ID_PCM_S16LE||id==AV_CODEC_ID_PCM_ALAW||id==AV_CODEC_ID_PCM_MULAW;}
int main(int argc,char **argv){
 if(argc!=5)return 2;
 int source_size=!strcmp(argv[1],"mpegts-source");
 int low_power=!strcmp(argv[1],"mpegts-low-power");
 int file=!strcmp(argv[1],"mp4"),framed=source_size||low_power||!strcmp(argv[1],"mpegts-dynamic");
 if(!file&&!framed&&strcmp(argv[1],"mpegts"))return 2;
 int max_width=atoi(argv[2]);double seek=atof(argv[3]);unsigned size=(unsigned)strtoul(argv[4],0,10);
 if(max_width<160||max_width>1920||!isfinite(seek)||seek<0||seek>600||(!file&&size)||size>INPUT_LIMIT)return 2;
 _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);setvbuf(stdout,0,_IONBF,0);
#ifdef MIJIA_OFFLINE_DECODER_DEBUG
 av_log_set_level(AV_LOG_DEBUG);
#else
 av_log_set_level(AV_LOG_QUIET);
#endif
 SetPriorityClass(GetCurrentProcess(),BELOW_NORMAL_PRIORITY_CLASS);
 Input input={0};input.file=file;input.framed=framed;input.source_size=source_size;input.low_power=low_power;input.width=max_width;input.height=1080;
 int result=3;
 AVFormatContext *format=avformat_alloc_context();AVIOContext *io=0;AVPacket *packet=av_packet_alloc();AVFrame *frame=av_frame_alloc();
 AVCodecContext *video=0,*audio=0;struct SwsContext *scale=0;SwrContext *resample=0;uint8_t *pixels=0;float *samples=0;int pixels_size=0,samples_size=0;
 if(!format||!packet||!frame)goto cleanup;
 if(file){input.size=size;if(!size||(input.data=av_malloc(size))==0)goto cleanup;size_t count=0;while(count<size){int n=_read(_fileno(stdin),input.data+count,(unsigned)(size-count));if(n<=0)goto cleanup;count+=n;}}
 uint8_t *buffer=av_malloc(32768);if(!buffer)goto cleanup;io=avio_alloc_context(buffer,32768,0,&input,read_input,0,file?seek_input:0);if(!io){av_free(buffer);goto cleanup;}
 format->pb=io;format->flags|=AVFMT_FLAG_CUSTOM_IO;format->probesize=1024*1024;format->max_analyze_duration=700000;format->max_streams=16;format->max_index_size=1024*1024;
 const AVInputFormat *demux=av_find_input_format(file?"mov":"mpegts");if(!demux||avformat_open_input(&format,0,demux,0)<0)goto cleanup;
 if(avformat_find_stream_info(format,0)<0)goto cleanup;
 int vi=av_find_best_stream(format,AVMEDIA_TYPE_VIDEO,-1,-1,0,0),ai=av_find_best_stream(format,AVMEDIA_TYPE_AUDIO,-1,-1,0,0);
 if(vi<0)goto cleanup;
 for(int type=0;type<2;type++){
  int index=type?ai:vi;if(index<0)continue;AVCodecParameters *p=format->streams[index]->codecpar;
  if(!supported(p->codec_id)){if(!type)goto cleanup;continue;}
  if(!type&&(p->width<=0||p->height<=0||(uint64_t)p->width*p->height>PIXEL_LIMIT))goto cleanup;
  const AVCodec *codec=avcodec_find_decoder(p->codec_id);AVCodecContext *c=codec?avcodec_alloc_context3(codec):0;
  if(!c||avcodec_parameters_to_context(c,p)<0){avcodec_free_context(&c);if(!type)goto cleanup;continue;}
  c->thread_count=1;c->max_pixels=PIXEL_LIMIT;
  if(!file&&!type)c->skip_frame=AVDISCARD_NONREF;
  if(avcodec_open2(c,codec,0)<0){avcodec_free_context(&c);if(!type)goto cleanup;continue;}
  if(type)audio=c;else video=c;
 }
 if(file&&seek>0){int64_t target=(int64_t)(seek/av_q2d(format->streams[vi]->time_base));if(av_seek_frame(format,vi,target,AVSEEK_FLAG_BACKWARD)>=0){avcodec_flush_buffers(video);if(audio)avcodec_flush_buffers(audio);}}
 double last_video=-1000;int decoded=0;
 int draining=0;
 for(;;){
  int index,sent;AVCodecContext *decoder;
  if(!draining&&av_read_frame(format,packet)>=0){index=packet->stream_index;decoder=index==vi?video:index==ai?audio:0;if(!decoder){av_packet_unref(packet);continue;}sent=avcodec_send_packet(decoder,packet);av_packet_unref(packet);}
  else{if(draining>1)break;index=draining++?ai:vi;decoder=index==vi?video:audio;if(index<0||!decoder)continue;sent=avcodec_send_packet(decoder,0);}
  if(sent<0&&sent!=AVERROR(EAGAIN))continue;
  while(avcodec_receive_frame(decoder,frame)>=0){
   int64_t stamp=frame->best_effort_timestamp;double pts=stamp==AV_NOPTS_VALUE?last_video+1.0/15:stamp*av_q2d(format->streams[index]->time_base)-(file?0:1);
   if(!isfinite(pts)||pts<0||pts>864000){av_frame_unref(frame);continue;}
   if(file&&pts+.001<seek){av_frame_unref(frame);continue;}
   if(index==vi){
    if((uint64_t)frame->width*frame->height>PIXEL_LIMIT||frame->width<=0||frame->height<=0)goto cleanup;
    if(source_size&&(frame->width>3840||frame->height>3840||(uint64_t)frame->width*frame->height>SOURCE_LIMIT))goto cleanup;
    double factor=source_size?1.0:fmin(1.0,fmin((double)input.width/frame->width,(double)input.height/frame->height));
    if(low_power){
     int long_edge=input.pressure?854:1280,short_edge=input.pressure?480:720;
     if(frame->width<frame->height){int swap=long_edge;long_edge=short_edge;short_edge=swap;}
     factor=fmin(factor,fmin((double)long_edge/frame->width,(double)short_edge/frame->height));
    }
    int w=(int)(frame->width*factor),h=(int)(frame->height*factor);
    int fps=w*h>1920*1080?8:15;
    fps=low_power?(input.pressure?6:10):fps>>input.pressure;
    if(pts-last_video<1.0/fps-.002){av_frame_unref(frame);continue;}
    if(w<1||h<1)goto cleanup;int bytes=w*h*4;if(bytes>pixels_size){av_free(pixels);pixels=av_malloc(bytes);pixels_size=bytes;if(!pixels)goto cleanup;}
    scale=sws_getCachedContext(scale,frame->width,frame->height,frame->format,w,h,AV_PIX_FMT_RGBA,SWS_BILINEAR,0,0,0);if(!scale)goto cleanup;
    uint8_t *dest[]={pixels,0,0,0};int strides[]={w*4,0,0,0};sws_scale(scale,(const uint8_t *const *)frame->data,frame->linesize,0,frame->height,dest,strides);
    if(!output(1,w,h,pts,0,pixels,bytes,(uint32_t)frame->width|((uint32_t)frame->height<<16)))goto cleanup;last_video=pts;decoded++;
   }else if(file&&audio){
    if(!resample){AVChannelLayout stereo=AV_CHANNEL_LAYOUT_STEREO;if(swr_alloc_set_opts2(&resample,&stereo,AV_SAMPLE_FMT_FLT,48000,&frame->ch_layout,frame->format,frame->sample_rate,0,0)<0||swr_init(resample)<0)goto cleanup;}
    int count=swr_get_out_samples(resample,frame->nb_samples);if(count<0||count>48000)goto cleanup;
    if(count*2>samples_size){av_free(samples);samples=av_malloc(count*2*sizeof(float));samples_size=count*2;if(!samples)goto cleanup;}
    uint8_t *out=(uint8_t*)samples;int n=swr_convert(resample,&out,count,(const uint8_t **)frame->extended_data,frame->nb_samples);
    if(n>0&&!output(2,2,0,pts,(double)n/48000,samples,n*2*sizeof(float),48000))goto cleanup;
   }
   av_frame_unref(frame);
  }
 }
 result=decoded?0:4;if(decoded)output(4,0,0,last_video,0,0,0,0);
cleanup:
 swr_free(&resample);sws_freeContext(scale);av_free(pixels);av_free(samples);avcodec_free_context(&video);avcodec_free_context(&audio);
 av_frame_free(&frame);av_packet_free(&packet);avformat_close_input(&format);if(io){av_freep(&io->buffer);avio_context_free(&io);}av_free(input.data);
 return result;
}
