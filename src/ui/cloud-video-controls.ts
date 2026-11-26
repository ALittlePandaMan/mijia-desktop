import {mediaView} from '../media-surface';
import type {CloudVideoSequence} from '../cloud-video-sequence';
import {button,element} from './dom';
import {icon,officialIcon} from '../icons';
import {cameraSoundIcon} from './camera-sound-icons';
import './cloud-video-controls.css';
export class CloudVideoControls {
 readonly root=element('div','cloud-video-controls');readonly top=element('div','cloud-video-top');
 private pause=button('','cloud-video-button',()=>{void this.toggle();});private current=element('span','cloud-video-clock');private duration=element('span','cloud-video-clock');private seek=element('input','cloud-video-seek');private sound=button('','cloud-video-button',()=>{if(mediaView(this.video).playbackRate!==1)return;mediaView(this.video).muted=!mediaView(this.video).muted;this.update();});private speed=button('1×','cloud-video-button cloud-video-speed',()=>{const rates=[1,1.5,2,4];mediaView(this.video).playbackRate=rates[(rates.indexOf(mediaView(this.video).playbackRate)+1)%rates.length];this.update();});
 private download?:HTMLButtonElement;private saving=false;
 private speedLabel=element('span','','1×');
 get blocksSuspension():boolean{return this.saving;}
 constructor(private video:HTMLVideoElement,private viewport:HTMLElement,private error:(message:string)=>void,save?:()=>Promise<unknown>,private timeline?:CloudVideoSequence,private playError=error){
  this.pause.classList.add('cloud-video-pause');this.seek.type='range';this.seek.min='0';this.seek.step='.05';this.seek.value='0';this.seek.setAttribute('aria-label','录像播放进度');this.seek.addEventListener('input',()=>{if(this.timeline?.active)this.timeline.seek(Number(this.seek.value));else if(Number.isFinite(mediaView(video).duration))mediaView(video).currentTime=Number(this.seek.value);});
  const full=button('','cloud-video-button',()=>{void(viewport.matches(':fullscreen')?document.exitFullscreen():viewport.requestFullscreen()).catch(()=>{});});const fullGlyph=officialIcon('camera:fullscreen');fullGlyph.setAttribute('viewBox','39 39 72 72');full.append(fullGlyph);full.setAttribute('aria-label','全屏');this.speed.setAttribute('aria-label','云录像播放速度');
  this.speed.replaceChildren(this.speedLabel);
  this.root.append(this.pause,this.current,this.seek,this.duration,this.sound,this.speed,full);
  if(save){const download=this.download=button('','cloud-video-button',()=>{if(this.saving)return;this.saving=true;this.update();void save().catch(e=>this.error(e?.message??'录像保存失败，请重试。')).finally(()=>{this.saving=false;this.update();});});download.setAttribute('aria-label','保存云录像');download.append(downloadIcon());this.top.append(download);}
  for(const event of['loadedmetadata','loadeddata','timeupdate','play','pause','ended','volumechange','ratechange','emptied','error'])video.addEventListener(event,()=>this.update());this.update();
 }
 async toggle():Promise<void>{try{if(mediaView(this.video).paused){if(this.timeline?.active)await this.timeline.play();else await mediaView(this.video).play();}else if(this.timeline?.active)this.timeline.pause();else mediaView(this.video).pause();this.update();}catch(error){if((error as {name?:string}|null)?.name!=='AbortError')this.playError('当前录像暂时无法播放，请重试。');}}
 update():void{
  const view=mediaView(this.video),ready=view.readyState>=2&&!view.error,rate=view.playbackRate;
  this.pause.disabled=this.seek.disabled=this.speed.disabled=!ready;this.sound.disabled=!ready||rate!==1;
  if(rate!==1&&!view.muted)view.muted=true;
  if(this.download)this.download.disabled=!ready||this.saving;
  const playbackKind=view.paused?'play':'pause';
  if(this.pause.dataset.playbackIcon!==playbackKind){
   this.pause.dataset.playbackIcon=playbackKind;this.pause.replaceChildren(icon(view.paused?'speaker:play':'speaker:pause'));
   this.pause.setAttribute('aria-label',view.paused?'播放录像':'暂停录像');this.viewport.dataset.cloudPaused=String(view.paused);
  }
  const soundKind=view.muted?'muted':'sound';
  if(this.sound.dataset.soundIcon!==soundKind){
   this.sound.dataset.soundIcon=soundKind;this.sound.replaceChildren(cameraSoundIcon(!view.muted));
   this.sound.setAttribute('aria-label',view.muted?'打开声音':'关闭声音');
  }
  const current=this.timeline?.active?this.timeline.currentTime:view.currentTime;
  const duration=this.timeline?.active?this.timeline.duration:view.duration;
  const position=clock(current),total=clock(duration),speed=`${rate}×`;
  if(this.current.textContent!==position)this.current.textContent=position;
  if(this.duration.textContent!==total)this.duration.textContent=total;
  if(this.speedLabel.textContent!==speed)this.speedLabel.textContent=speed;
  const max=String(Number.isFinite(duration)?duration:0);if(this.seek.max!==max)this.seek.max=max;
  if(!this.seek.matches(':active'))this.seek.value=String(current);
 }
}
function clock(n:number):string{const seconds=Number.isFinite(n)?Math.floor(Math.max(0,n)):0;return`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function downloadIcon():SVGSVGElement{const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(ns,'path');path.setAttribute('d','M12 3v13m-4-4 4 4 4-4M5 18v3h14v-3');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.5');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);return svg;}
