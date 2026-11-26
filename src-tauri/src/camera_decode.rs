//! Isolated, stdin-only FFmpeg preview worker. Never owns a device connection.
use crate::{error::{AppError,Result},state::AppState};
use base64::{engine::general_purpose::STANDARD,Engine};
use serde::{Deserialize,Serialize};
use std::{collections::HashMap,io::{Read,Write},process::{Child,Command,Stdio},sync::{Arc,Condvar,Mutex,OnceLock,atomic::{AtomicBool,AtomicU64,Ordering},mpsc::{sync_channel,SyncSender}},time::Duration};
use tauri::{Emitter,Manager};

#[derive(Clone,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Context{home_id:String,generation:u64,did:String}
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
struct Frame{kind:u32,width:u32,height:u32,pts:f64,duration:f64,bytes:u32,rate:u32,source_width:u32,source_height:u32,dropped_frames:u64}

const HD_PIXELS:u32=1920*1080;
const UHD_PIXELS:u32=3840*2160;
const MAX_WORKERS:usize=16;

#[derive(Clone,Copy,PartialEq,Eq)]
struct Viewport{width:u32,height:u32}
impl Viewport{
 fn checked(width:u32,height:u32)->Result<Self>{
  if width==0||height==0||width>3840||height>3840||width*height>UHD_PIXELS{return Err(AppError::invalid("预览尺寸无效。"));}
  Ok(Self{width,height})
 }
 fn limited(self,long:u32,short:u32)->Self{
  let (width,height)=if self.width>=self.height{(long,short)}else{(short,long)};
  let scale=1.0_f64.min(width as f64/self.width as f64).min(height as f64/self.height as f64);
  Self{width:((self.width as f64*scale).round() as u32).max(1),height:((self.height as f64*scale).round() as u32).max(1)}
 }
 fn wide(self)->bool{self.width>1920||self.height>1920||self.width*self.height>HD_PIXELS}
 fn write(self,output:&mut impl Write)->std::io::Result<()>{
  let mut record=[0u8;12];
  record[4..8].copy_from_slice(&self.width.to_le_bytes());
  record[8..12].copy_from_slice(&self.height.to_le_bytes());
  output.write_all(&record)
 }
}

struct Lease{app:tauri::AppHandle,owner:String,context:Context,identity:usize,child:Mutex<Child>,input:Mutex<Option<SyncSender<Vec<u8>>>>,viewport:Mutex<Option<Viewport>>,pressure:AtomicU64,remaining:AtomicU64,posted:AtomicU64,ack:Mutex<u64>,ack_changed:Condvar,stop:AtomicBool}
impl Lease{
 fn close(&self)->bool{
  // Change the predicate under the same lock used by the sleeping reader.
  let ack=self.ack.lock().unwrap();
  if self.stop.swap(true,Ordering::AcqRel){return false;}
  self.ack_changed.notify_all();drop(ack);
  self.input.lock().unwrap().take();
  let mut child=self.child.lock().unwrap();
  let _=child.kill();let _=child.wait();
  true
 }
 fn wait_for_ack(&self,sequence:u64,timeout:Option<Duration>)->bool{
  let ack=self.ack.lock().unwrap();
  let pending=|ack:&mut u64|*ack<sequence&&!self.stop.load(Ordering::Acquire);
  let ack=match timeout{
   Some(duration)=>self.ack_changed.wait_timeout_while(ack,duration,pending).unwrap().0,
   None=>self.ack_changed.wait_while(ack,pending).unwrap(),
  };
  *ack>=sequence&&!self.stop.load(Ordering::Acquire)
 }
}
impl Drop for Lease{fn drop(&mut self){self.close();}}
type Registry=Mutex<HashMap<String,Arc<Lease>>>;
fn registry()->&'static Registry{static MAP:OnceLock<Registry>=OnceLock::new();MAP.get_or_init(Default::default)}
fn error(kind:&str)->AppError{AppError::new(kind,"视频兼容播放器暂不可用，请重试。",true)}
fn lease(window:&tauri::WebviewWindow,id:&str)->Result<Arc<Lease>>{registry().lock().unwrap().get(id).filter(|l|l.owner==window.label()&&!l.stop.load(Ordering::Acquire)).cloned().ok_or_else(AppError::stale)}
async fn valid(state:&AppState,l:&Lease)->Result<()>{if l.stop.load(Ordering::Acquire)||state.validate_camera_decoder(&l.context.home_id,l.context.generation,&l.context.did).await?!=l.identity{return Err(AppError::stale());}Ok(())}
fn remove(id:&str,l:&Arc<Lease>){
 // The Job Object releases the process slot only after the worker exits.
 if !l.close(){return;}
 let mut map=registry().lock().unwrap();
 if !map.get(id).is_some_and(|old|Arc::ptr_eq(old,l)){return;}
 map.remove(id);drop(map);
 let _=l.app.emit("camera-decoder-available",());
}

#[cfg(windows)]
use decoder_job::contain;

#[cfg(windows)]
mod decoder_job {
    use super::{error, Result, MAX_WORKERS};
    use std::{
        io,
        mem::{size_of_val, zeroed},
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::Child,
        ptr::null,
        sync::Mutex,
    };
    use windows_sys::Win32::{Foundation::{ERROR_NOT_SUPPORTED, HANDLE}, System::JobObjects::*};

    const LIMITS: u32 = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        | JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    const WORKER_MEMORY: usize = 512 * 1024 * 1024;
    const TOTAL_MEMORY: usize = 1024 * 1024 * 1024;

    pub(super) fn contain(child: &Child) -> Result<()> {
        static JOB: Mutex<Option<OwnedHandle>> = Mutex::new(None);
        let mut job = JOB.lock().unwrap();
        if job.is_none() {
            *job = Some(create(apply_cpu_rate)?);
        }
        let handle = job.as_ref().unwrap().as_raw_handle();
        if unsafe { AssignProcessToJobObject(handle, child.as_raw_handle()) } == 0 {
            return Err(error("decodeIsolation"));
        }
        Ok(())
    }

    fn create(apply_cpu: impl FnOnce(HANDLE) -> io::Result<()>) -> Result<OwnedHandle> {
        let raw = unsafe { CreateJobObjectW(null(), null()) };
        if raw.is_null() {
            return Err(error("decodeIsolation"));
        }
        let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        limits.BasicLimitInformation.LimitFlags = LIMITS;
        limits.BasicLimitInformation.ActiveProcessLimit = MAX_WORKERS as u32;
        limits.ProcessMemoryLimit = WORKER_MEMORY;
        limits.JobMemoryLimit = TOTAL_MEMORY;
        if unsafe {
            SetInformationJobObject(raw, JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(), size_of_val(&limits) as u32)
        } == 0 {
            return Err(error("decodeIsolation"));
        }
        if let Err(failure) = apply_cpu(raw) {
            // Windows rejects the CPU quota while Dynamic Fair Share Scheduling is active.
            // The process count, memory limits and job lifetime still apply.
            if failure.raw_os_error() != Some(ERROR_NOT_SUPPORTED as i32) {
                return Err(error("decodeIsolation"));
            }
        }
        Ok(handle)
    }

    fn apply_cpu_rate(job: HANDLE) -> io::Result<()> {
        let mut rate: JOBOBJECT_CPU_RATE_CONTROL_INFORMATION = unsafe { zeroed() };
        rate.ControlFlags = JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;
        rate.Anonymous.CpuRate = 6000;
        if unsafe {
            SetInformationJobObject(job, JobObjectCpuRateControlInformation,
                (&rate as *const JOBOBJECT_CPU_RATE_CONTROL_INFORMATION).cast(), size_of_val(&rate) as u32)
        } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    #[cfg(test)]
    #[test]
    fn job_keeps_all_required_limits_when_cpu_rate_is_unavailable() {
        let job = create(|_| Err(io::Error::from_raw_os_error(ERROR_NOT_SUPPORTED as i32))).unwrap();
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        assert_ne!(unsafe {
            QueryInformationJobObject(job.as_raw_handle(), JobObjectExtendedLimitInformation,
                (&mut limits as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(), size_of_val(&limits) as u32, std::ptr::null_mut())
        }, 0);
        assert_eq!(limits.BasicLimitInformation.LimitFlags & LIMITS, LIMITS);
        assert_eq!(limits.BasicLimitInformation.ActiveProcessLimit, MAX_WORKERS as u32);
        assert_eq!(limits.ProcessMemoryLimit, WORKER_MEMORY);
        assert_eq!(limits.JobMemoryLimit, TOTAL_MEMORY);
        let other = create(|_| Err(io::Error::from(io::ErrorKind::PermissionDenied)));
        assert_eq!(other.unwrap_err().kind, "decodeIsolation");
    }
}
#[cfg(not(windows))]
fn contain(_child:&Child)->Result<()>{Err(error("decodeUnsupported"))}

fn runtime_error()->AppError{AppError::new("decodeRuntime","兼容播放需要更新 Microsoft Edge WebView2 Runtime。",false)}

#[cfg(windows)]
pub(crate) fn webview_runtime_available()->bool{
 use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
 use windows::core::{w,PCWSTR,PWSTR};
 use windows_sys::Win32::{System::Com::CoTaskMemFree,UI::WindowsAndMessaging::*};
 unsafe{
  // Respect WebView2's standard runtime selection, including enterprise policy.
  let mut version=PWSTR::null();
  let available=GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(),&mut version).is_ok()&&!version.is_null();
  CoTaskMemFree(version.0.cast());
  if !available{
   MessageBoxW(std::ptr::null_mut(),
    w!("此电脑缺少 Microsoft Edge WebView2 Runtime。请安装微软提供的 WebView2 Evergreen x64 运行时后重新打开。").as_ptr(),
    w!("米家Desktop").as_ptr(),MB_OK|MB_ICONERROR);
  }
  available
 }
}

#[cfg(windows)]
async fn check_shared_buffers(window:&tauri::WebviewWindow)->Result<()>{
 use webview2_com::Microsoft::Web::WebView2::Win32::*;
 use windows::core::Interface;
 let (send,receive)=tokio::sync::oneshot::channel();
 window.with_webview(move|native|{
  let supported=(||unsafe{
   let view=native.controller().CoreWebView2()?;
   let _:ICoreWebView2_17=view.cast()?;
   let _:ICoreWebView2Environment12=view.cast::<ICoreWebView2_2>()?.Environment()?.cast()?;
   Ok::<_,windows::core::Error>(())
  })().is_ok();
  let _=send.send(supported);
 }).map_err(|_|runtime_error())?;
 match tokio::time::timeout(Duration::from_secs(5),receive).await{
  Ok(Ok(true))=>Ok(()),
  _=>Err(runtime_error()),
 }
}
#[cfg(not(windows))]
async fn check_shared_buffers(_window:&tauri::WebviewWindow)->Result<()>{Err(error("decodeUnsupported"))}

#[tauri::command]
pub async fn camera_decode_open(window:tauri::WebviewWindow,state:tauri::State<'_,AppState>,id:String,context:Context,format:String,size:u32,offset:f64,width:Option<u32>,height:Option<u32>,preserve_source:Option<bool>,low_power:Option<bool>,replay:Option<bool>)->Result<()>{
 let transport=format=="mpegts";
 let preserve_source=preserve_source.unwrap_or(false);
 let low_power=low_power.unwrap_or(false);
 let replay=replay.unwrap_or(false);
 if uuid::Uuid::parse_str(&id).is_err()||!matches!(format.as_str(),"mpegts"|"mp4")||!offset.is_finite()||!(0.0..=600.0).contains(&offset)||size>48*1024*1024||transport&&size!=0||!transport&&(size==0||preserve_source||low_power||replay)||preserve_source&&(low_power||replay){return Err(AppError::invalid("视频解码参数无效。"));}
 let realtime=transport&&!replay;
 let viewport=Viewport::checked(width.unwrap_or(1280),height.unwrap_or(1080))?;
 let identity=state.validate_camera_decoder(&context.home_id,context.generation,&context.did).await?;
 check_shared_buffers(&window).await?;
 if state.validate_camera_decoder(&context.home_id,context.generation,&context.did).await?!=identity{return Err(AppError::stale());}
 let directory=window.app_handle().path().resource_dir().map_err(|_|error("decodeMissing"))?.join("media-decoder");
 let executable=directory.join("mijia-media-decoder.exe");
 let worker_mode=if low_power{"mpegts-low-power"}else if preserve_source{"mpegts-source"}else if transport{"mpegts-dynamic"}else{"mp4"};
 let mut command=Command::new(&executable);command.current_dir(&directory).args([worker_mode,&viewport.width.clamp(160,1920).to_string(),&offset.to_string(),&size.to_string()]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
 #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
 // Reserve admission while spawning: no duplicate ID or unbounded helper burst.
 let mut map=registry().lock().unwrap();
 if map.contains_key(&id){return Err(AppError::stale());}
 if map.len()>=MAX_WORKERS{return Err(error("decodeCapacity"));}
 let mut child=command.spawn().map_err(|_|error("decodeMissing"))?;
 if let Err(e)=contain(&child){let _=child.kill();let _=child.wait();return Err(e);}
 let mut input=child.stdin.take().unwrap();let mut output=child.stdout.take().unwrap();let(tx,rx)=sync_channel::<Vec<u8>>(8);
 let viewport=admit_viewport(&map,&id,viewport);
 let l=Arc::new(Lease{app:window.app_handle().clone(),owner:window.label().into(),context,identity,child:Mutex::new(child),input:Mutex::new(Some(tx)),viewport:Mutex::new((transport&&!preserve_source).then_some(viewport)),pressure:AtomicU64::new(0),remaining:AtomicU64::new(if transport{u64::MAX}else{size as u64}),posted:AtomicU64::new(0),ack:Mutex::new(0),ack_changed:Condvar::new(),stop:AtomicBool::new(false)});map.insert(id.clone(),l.clone());drop(map);
 let writer=l.clone();std::thread::Builder::new().name("preview-input".into()).spawn(move||{
  let mut sent=None;
  let mut sent_pressure=0;
  while let Ok(bytes)=rx.recv(){
   if writer.stop.load(Ordering::Acquire){break;}
   if transport{
    if bytes.is_empty(){continue;}
    let pressure=writer.pressure.load(Ordering::Acquire) as u32;
    if preserve_source||low_power{
     if pressure!=sent_pressure{
      let mut control=[0xff;8];
      control[4..].copy_from_slice(&pressure.to_le_bytes());
      if input.write_all(&control).is_err(){break;}
      sent_pressure=pressure;
     }
    }
    if let Some(viewport)=*writer.viewport.lock().unwrap(){
     let viewport=match (low_power,pressure){
      (true,0)=>viewport.limited(1280,720),
      (true,_)=>viewport.limited(854,480),
      (false,0)=>viewport,
      (false,1) if viewport.wide()=>viewport.limited(1920,1080),
      (false,1)=>viewport.limited(1280,720),
      (false,_)=>viewport.limited(854,480),
     };
     if sent!=Some(viewport){
      if viewport.write(&mut input).is_err(){break;}
      sent=Some(viewport);
     }
    }
    if input.write_all(&(bytes.len() as u32).to_le_bytes()).is_err(){break;}
   }
   if input.write_all(&bytes).is_err(){break;}
  }
 }).map_err(|_|{remove(&id,&l);error("decodeWorker")})?;
 let app=window.app_handle().clone();let reader=l.clone();let task_id=id.clone();
 std::thread::Builder::new().name("preview-output".into()).spawn(move||{
  let mut sequence=0u64;let mut finished=false;let mut dropped=0;let mut missed=0;let mut good=0;let mut posted_at=std::time::Instant::now();let mut pixels=Vec::new();
  while !reader.stop.load(Ordering::Acquire){
   let mut header=[0;40];if output.read_exact(&mut header).is_err(){break;}
   let Some(mut frame)=parse_header(&header) else{break;};pixels.resize(frame.bytes as usize,0);if output.read_exact(&mut pixels).is_err(){break;}
   if realtime&&frame.kind==1&&*reader.ack.lock().unwrap()<sequence{
    if posted_at.elapsed()>Duration::from_secs(10){break;}
    dropped+=1;missed+=1;good=0;
    if missed>=4{
     let _=reader.pressure.fetch_update(Ordering::AcqRel,Ordering::Acquire,|level|(level<2).then_some(level+1));
     missed=0;
    }
    continue;
   }
   if frame.kind==1{
    if missed==0{good+=1;}
    if good>=120{
     let _=reader.pressure.fetch_update(Ordering::AcqRel,Ordering::Acquire,|level|level.checked_sub(1));
     good=0;
    }
    missed=0;
   }
   frame.dropped_frames=dropped;
   if frame.kind==4{pixels.push(0);frame.bytes=1;}
   if tauri::async_runtime::block_on(async{let state=app.state::<AppState>();valid(state.inner(),&reader).await}).is_err(){break;}
   if frame.kind==4&&realtime&&!reader.wait_for_ack(sequence,Some(Duration::from_secs(10))){break;}
   sequence+=1;reader.posted.store(sequence,Ordering::Release);let Some(view)=app.get_webview_window(&reader.owner)else{break;};
   pixels=match post_frame(&view,&task_id,sequence,&frame,pixels){Ok(buffer)=>buffer,Err(_)=>break};
   posted_at=std::time::Instant::now();
   if !realtime||frame.kind==4{
    // A paused clip intentionally holds its next frame until playback resumes.
    if !reader.wait_for_ack(sequence,None){break;}
   }
   if frame.kind==4{finished=true;break;}
  }
  if !reader.stop.load(Ordering::Acquire)&&!finished{let _=app.emit_to(&reader.owner,"camera-decoder-error",serde_json::json!({"id":task_id,"kind":"decodeFailed"}));}
  remove(&task_id,&reader);
 }).map_err(|_|{remove(&id,&l);error("decodeWorker")})?;
 let app=window.app_handle().clone();let lifetime=l.clone();let lifetime_id=id.clone();std::thread::Builder::new().name("preview-lifetime".into()).spawn(move||{
  let l=lifetime;let id=lifetime_id;
  while !l.stop.load(Ordering::Acquire){std::thread::sleep(Duration::from_secs(2));if app.get_webview_window(&l.owner).is_none()||tauri::async_runtime::block_on(async{let state=app.state::<AppState>();valid(state.inner(),&l).await}).is_err(){let _=app.emit_to(&l.owner,"camera-decoder-error",serde_json::json!({"id":id,"kind":"staleContext"}));remove(&id,&l);break;}}
 }).map_err(|_|{remove(&id,&l);error("decodeWorker")})?;Ok(())
}

fn admit_viewport(map:&HashMap<String,Arc<Lease>>,id:&str,viewport:Viewport)->Viewport{
 if viewport.wide()&&map.iter().any(|(key,other)|key!=id&&other.viewport.lock().unwrap().is_some_and(Viewport::wide)){viewport.limited(1920,1080)}else{viewport}
}

#[tauri::command]
pub async fn camera_decode_viewport(window:tauri::WebviewWindow,state:tauri::State<'_,AppState>,id:String,width:u32,height:u32)->Result<()>{
 let l=lease(&window,&id)?;valid(state.inner(),&l).await?;
 let viewport=Viewport::checked(width,height)?;
 let map=registry().lock().unwrap();
 let viewport=admit_viewport(&map,&id,viewport);
 let mut current=l.viewport.lock().unwrap();
 if current.is_none(){return Err(AppError::invalid("此播放器不接受实时尺寸更新。"));}
 if *current!=Some(viewport){*current=Some(viewport);l.pressure.store(0,Ordering::Release);}
 Ok(())
}

fn parse_header(h:&[u8;40])->Option<Frame>{
 if &h[..4]!=b"MJFR"{return None;}let u=|at|u32::from_le_bytes(h[at..at+4].try_into().unwrap());let f=|at|f64::from_le_bytes(h[at..at+8].try_into().unwrap());
 let frame=Frame{kind:u(4),width:u(8),height:u(12),pts:f(16),duration:f(24),bytes:u(32),rate:u(36),source_width:u(36)&65535,source_height:u(36)>>16,dropped_frames:0};
 if !frame.pts.is_finite()||!(0.0..=864000.0).contains(&frame.pts)||!frame.duration.is_finite()||frame.bytes>UHD_PIXELS*4{return None;}
 match frame.kind{1 if Viewport::checked(frame.width,frame.height).is_ok()&&frame.source_width>=frame.width&&frame.source_height>=frame.height&&frame.width.checked_mul(frame.height)?.checked_mul(4)?==frame.bytes=>Some(frame),2 if frame.rate==48000&&frame.width==2&&frame.bytes<=48000*8&&frame.bytes%8==0=>Some(frame),4 if frame.bytes==0=>Some(frame),_=>None}
}
#[cfg(windows)]
fn post_frame(window:&tauri::WebviewWindow,id:&str,sequence:u64,frame:&Frame,pixels:Vec<u8>)->Result<Vec<u8>>{
 use webview2_com::Microsoft::Web::WebView2::Win32::*;use windows::core::{Interface,PCWSTR};
 let json=serde_json::json!({"kind":"mijia-software-media","id":id,"sequence":sequence,"frame":frame}).to_string();let wide:Vec<u16>=json.encode_utf16().chain(Some(0)).collect();let(tx,rx)=std::sync::mpsc::sync_channel(1);
 window.with_webview(move|web|{let result=(||unsafe{
  let view=web.controller().CoreWebView2()?;let environment=view.cast::<ICoreWebView2_2>()?.Environment()?.cast::<ICoreWebView2Environment12>()?;
  let buffer=environment.CreateSharedBuffer(pixels.len() as u64)?;let mut destination=std::ptr::null_mut();buffer.Buffer(&mut destination)?;std::ptr::copy_nonoverlapping(pixels.as_ptr(),destination,pixels.len());
  let posted=view.cast::<ICoreWebView2_17>()?.PostSharedBufferToScript(&buffer,COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,PCWSTR(wide.as_ptr()));let _=buffer.Close();posted
 })();let _=tx.send(result.is_ok().then_some(pixels));}).map_err(|_|error("decodeRender"))?;
 rx.recv_timeout(Duration::from_secs(5)).ok().flatten().ok_or_else(||error("decodeRender"))
}
#[cfg(not(windows))]
fn post_frame(_window:&tauri::WebviewWindow,_id:&str,_sequence:u64,_frame:&Frame,_pixels:Vec<u8>)->Result<Vec<u8>>{Err(error("decodeUnsupported"))}
#[tauri::command]
pub async fn camera_decode_feed(window:tauri::WebviewWindow,state:tauri::State<'_,AppState>,id:String,data:String)->Result<()>{
 let l=lease(&window,&id)?;valid(state.inner(),&l).await?;
 if data.len()>350000{return Err(AppError::invalid("视频解码数据过大。"));}let bytes=STANDARD.decode(data).map_err(|_|AppError::invalid("视频解码数据无效。"))?;
 if l.remaining.load(Ordering::Acquire)!=u64::MAX&&l.remaining.fetch_update(Ordering::AcqRel,Ordering::Acquire,|remaining|remaining.checked_sub(bytes.len() as u64)).is_err(){remove(&id,&l);return Err(AppError::invalid("视频解码长度无效。"));}
 let sender=l.input.lock().unwrap().as_ref().cloned().ok_or_else(AppError::stale)?;
 tauri::async_runtime::spawn_blocking(move||sender.send(bytes).map_err(|_|AppError::stale())).await.map_err(|_|error("decodeInput"))?
}
#[tauri::command]
pub fn camera_decode_finish(window:tauri::WebviewWindow,id:String)->Result<()>{let l=lease(&window,&id)?;if !matches!(l.remaining.load(Ordering::Acquire),0|u64::MAX){remove(&id,&l);return Err(AppError::invalid("视频解码数据不完整。"));}l.input.lock().unwrap().take();Ok(())}
#[tauri::command]
pub fn camera_decode_ack(window:tauri::WebviewWindow,id:String,sequence:u64)->Result<()>{let l=lease(&window,&id)?;let mut ack=l.ack.lock().unwrap();if sequence==*ack+1&&sequence==l.posted.load(Ordering::Acquire){*ack=sequence;l.ack_changed.notify_one();}Ok(())}
#[tauri::command]
pub async fn camera_decode_close(window:tauri::WebviewWindow,id:String)->Result<()>{
 if let Ok(l)=lease(&window,&id){
  tauri::async_runtime::spawn_blocking(move||remove(&id,&l)).await.map_err(|_|error("decodeWorker"))?;
 }
 Ok(())
}

#[cfg(test)]
mod tests {
 use super::*;

 #[test]
 fn accepts_uhd_and_rejects_invalid_dimensions() {
  let mut header=[0u8;40];
  header[..4].copy_from_slice(b"MJFR");
  header[4..8].copy_from_slice(&1u32.to_le_bytes());
  header[8..12].copy_from_slice(&3840u32.to_le_bytes());
  header[12..16].copy_from_slice(&2160u32.to_le_bytes());
  header[32..36].copy_from_slice(&(UHD_PIXELS*4).to_le_bytes());
  header[36..40].copy_from_slice(&(3840u32|(2160u32<<16)).to_le_bytes());
  assert!(parse_header(&header).is_some());
  header[16..24].copy_from_slice(&f64::NAN.to_le_bytes());
  assert!(parse_header(&header).is_none());
  header[16..24].copy_from_slice(&0f64.to_le_bytes());
  header[32..36].copy_from_slice(&u32::MAX.to_le_bytes());
  assert!(parse_header(&header).is_none());
  assert!(Viewport::checked(3840,3840).is_err());
  assert!(Viewport::checked(2160,3840).is_ok());
 }
}

/// Hidden WebView2 + real worker integration, compiled only for developer
/// inspection builds. This is not a camera permission bypass in the client.
#[cfg(feature="media-probe")]
pub fn offline_native_probe(){
 use std::sync::atomic::AtomicU64;
 static ACK:AtomicU64=AtomicU64::new(0);
 #[tauri::command]fn probe_ack(sequence:u64){ACK.fetch_max(sequence,Ordering::AcqRel);}
 let args:Vec<_>=std::env::args().collect();
 let preserve_source=args.get(1).is_some_and(|arg|arg=="--live-source");
 let first=1+usize::from(preserve_source);
 let input=std::path::PathBuf::from(args.get(first).expect("offline media fixture"));
 let output=std::path::PathBuf::from(args.get(first+1).expect("probe result"));
 let encoded=std::fs::read(input).expect("read offline fixture");assert!(encoded.len()<=48*1024*1024);
 let mut context=tauri::generate_context!();context.config_mut().app.windows.clear();context.config_mut().identifier="io.mijiadesktop.offline-media-probe".into();
 struct ProbeAssets;
 impl tauri::Assets<tauri::Wry> for ProbeAssets{
  fn get(&self,_key:&tauri::utils::assets::AssetKey)->Option<std::borrow::Cow<'_,[u8]>>{Some(std::borrow::Cow::Borrowed(b"<!doctype html><html><head><meta charset=utf-8><title>Offline media probe</title></head><body></body></html>"))}
  fn iter(&self)->Box<tauri::utils::assets::AssetsIter<'_>>{Box::new(std::iter::empty())}
  fn csp_hashes(&self,_key:&tauri::utils::assets::AssetKey)->Box<dyn Iterator<Item=tauri::utils::assets::CspHash<'_>>+'_>{Box::new(std::iter::empty())}
 }
 context.set_assets(Box::new(ProbeAssets));
 let saved=output.clone();let started=Arc::new(AtomicBool::new(false));
 tauri::Builder::default().invoke_handler(tauri::generate_handler![probe_ack]).setup(move|app|{
  let html=r#"(()=>{window.__mediaProbe={errors:[],events:0,ready:true};addEventListener('error',e=>__mediaProbe.errors.push(e.message));addEventListener('unhandledrejection',e=>__mediaProbe.errors.push(String(e.reason)));let count=0;const canvas=document.createElement('canvas');let c;window.chrome.webview.addEventListener('sharedbufferreceived',e=>{__mediaProbe.events++;const m=e.additionalData;if(m?.kind!=='mijia-software-media')return;const b=e.getBuffer(),f=m.frame;try{if(f.kind===1){canvas.width=f.width;canvas.height=f.height;c??=canvas.getContext('2d',{willReadFrequently:true});c.putImageData(new ImageData(new Uint8ClampedArray(b),f.width,f.height),0,0);if(c.getImageData(0,0,1,1).data[3]!==255)throw Error('invalid alpha');count++;}window.__TAURI_INTERNALS__.invoke('probe_ack',{sequence:m.sequence}).catch(e=>__mediaProbe.errors.push(String(e)));}catch(e){__mediaProbe.errors.push(String(e));}finally{window.chrome.webview.releaseBuffer(b);}});addEventListener('DOMContentLoaded',()=>{window.__TAURI_INTERNALS__.invoke('probe_ack',{sequence:1}).catch(e=>__mediaProbe.errors.push(String(e)));},{once:true});})()"#;
  let gate=started.clone();let saved=saved.clone();let bytes=encoded.clone();
  tauri::WebviewWindowBuilder::new(app,"main",tauri::WebviewUrl::App("index.html".into())).visible(false).initialization_script(html).on_page_load(move|window,payload|{
   if !matches!(payload.event(),tauri::webview::PageLoadEvent::Finished)||gate.swap(true,Ordering::AcqRel){return;}
   let window=window.clone();let saved=saved.clone();let bytes=bytes.clone();
   std::thread::spawn(move||{
    let result=(||->Result<serde_json::Value>{
     let ready=std::time::Instant::now()+Duration::from_secs(5);
     while ACK.load(Ordering::Acquire)==0 {if std::time::Instant::now()>ready{return Err(error("probePageNotReady"));}std::thread::sleep(Duration::from_millis(5));}
     let root=window.app_handle().path().resource_dir().map_err(|_|error("probeResource"))?.join("media-decoder");
     let mut cmd=Command::new(root.join("mijia-media-decoder.exe"));
     let length=if preserve_source{0}else{bytes.len()}.to_string();
     cmd.current_dir(&root).args([if preserve_source{"mpegts-source"}else{"mp4"},"640","0",&length]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
     #[cfg(windows)]{use std::os::windows::process::CommandExt;cmd.creation_flags(0x08000000);}
     let mut child=cmd.spawn().map_err(|_|error("probeSpawn"))?;if let Err(error)=contain(&child){let _=child.kill();let _=child.wait();return Err(error);}let mut stdin=child.stdin.take().unwrap();
     std::thread::spawn(move||{
      if preserve_source{
       for block in bytes.chunks(64*1024){
        if stdin.write_all(&(block.len() as u32).to_le_bytes()).and_then(|()|stdin.write_all(block)).is_err(){break;}
       }
      }else{let _=stdin.write_all(&bytes);}
     });
     let mut stream=child.stdout.take().unwrap();let start=std::time::Instant::now();let mut sequence=1;let mut frames=0;let mut audio=0;let mut frame_size=None;
     loop{let mut header=[0;40];if stream.read_exact(&mut header).is_err(){break;}let mut frame=parse_header(&header).ok_or_else(||error("probeHeader"))?;let mut pixels=vec![0;frame.bytes as usize];stream.read_exact(&mut pixels).map_err(|_|error("probeFrame"))?;
      if frame.kind==1{
       if preserve_source&&(frame.width!=frame.source_width||frame.height!=frame.source_height){
        let _=child.kill();let _=child.wait();return Err(error("probeResolution"));
       }
       frame_size=Some([frame.width,frame.height]);frames+=1;
      }
      if frame.kind==2{audio+=1;}if frame.kind==4{pixels.push(0);frame.bytes=1;}sequence+=1;post_frame(&window,"offline-probe",sequence,&frame,pixels)?;
      let deadline=std::time::Instant::now()+Duration::from_secs(10);while ACK.load(Ordering::Acquire)<sequence{if std::time::Instant::now()>deadline{let _=child.kill();let _=child.wait();
        #[cfg(windows)]{let trace=saved.with_extension("trace.json");let(tx,rx)=std::sync::mpsc::sync_channel(1);let _=window.with_webview(move|web|unsafe{let js:Vec<u16>="JSON.stringify({probe:window.__mediaProbe,internals:!!window.__TAURI_INTERNALS__,url:location.href,visibility:document.visibilityState})".encode_utf16().chain(Some(0)).collect();let handler=webview2_com::ExecuteScriptCompletedHandler::create(Box::new(move|_status,value|{let _=std::fs::write(trace,value);let _=tx.send(());Ok(())}));if let Ok(v)=web.controller().CoreWebView2(){let _=v.ExecuteScript(windows::core::PCWSTR(js.as_ptr()),&handler);}});let _=rx.recv_timeout(Duration::from_secs(2));}
        return Err(error("probeAckTimeout"));}std::thread::sleep(Duration::from_millis(2));}
      if frame.kind==4{break;}
     }
     let status=child.wait().map_err(|_|error("probeExit"))?;
     if !status.success()||if preserve_source{frames<20}else{frames<100||audio==0}{return Err(error("probeInsufficientFrames"));}
     Ok(serde_json::json!({"passed":true,"nativeWebView2":true,"visibleWindow":false,"preserveSource":preserve_source,"frameSize":frame_size,"videoFrames":frames,"audioBlocks":audio,"sharedBufferAcknowledgements":sequence-1,"elapsedMs":start.elapsed().as_millis(),"realDeviceWrites":0,"realCameraPreview":false}))
    })();
    let value=result.as_ref().cloned().unwrap_or_else(|e|serde_json::json!({"passed":false,"kind":e.kind,"realDeviceWrites":0}));let _=std::fs::write(saved,serde_json::to_vec_pretty(&value).unwrap());window.app_handle().exit(if result.is_ok(){0}else{1});
   });
  }).build()?;Ok(())
 }).run(context).expect("offline native media probe");
}
