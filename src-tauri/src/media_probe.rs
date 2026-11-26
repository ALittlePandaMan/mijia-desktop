// Development-only hidden WebView2 integration probe. No AppState or account is
// created, and no camera/cloud command is registered in this process.
fn main(){
    let args:Vec<_>=std::env::args().collect();
    if args.get(1).is_some_and(|arg|arg=="--system"){
        system_probe(&args[2],&args[3]);
    }else{
        mijia_desktop::camera_decode::offline_native_probe();
    }
}

fn system_probe(fixture:&str,output:&str){
    use std::{borrow::Cow,path::PathBuf, sync::Arc};

    struct Assets;
    impl tauri::Assets<tauri::Wry> for Assets{
        fn get(&self,key:&tauri::utils::assets::AssetKey)->Option<Cow<'_,[u8]>>{
            match key.as_ref(){
                "index.html"=>Some(Cow::Borrowed(b"<!doctype html><html><head><meta charset=utf-8><title>System decoder probe</title></head><body></body></html>")),
                _=>None,
            }
        }
        fn iter(&self)->Box<tauri::utils::assets::AssetsIter<'_>>{Box::new(std::iter::empty())}
        fn csp_hashes(&self,_key:&tauri::utils::assets::AssetKey)->Box<dyn Iterator<Item=tauri::utils::assets::CspHash<'_>>+'_>{Box::new(std::iter::empty())}
    }

    #[tauri::command]
    fn complete(app:tauri::AppHandle,output:tauri::State<'_,PathBuf>,result:serde_json::Value){
        std::fs::write(output.inner(),serde_json::to_vec_pretty(&result).unwrap()).expect("save system probe");
        app.exit(0);
    }
    #[tauri::command]
    fn sample(file:tauri::State<'_,Arc<[u8]>>)->tauri::ipc::Response{
        tauri::ipc::Response::new(file.to_vec())
    }

    let file=std::fs::read(fixture).expect("read offline MP4 fixture");
    assert!(file.len()<=48*1024*1024);
    let mut context=tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier="io.mijiadesktop.offline-system-media-probe".into();
    context.set_assets(Box::new(Assets));
    let probe=r#"addEventListener('DOMContentLoaded',async ()=>{
        const video=document.createElement('video');
        video.muted=true;video.playsInline=true;video.width=320;video.height=180;
        document.body.append(video);
        const started=performance.now();
        let done=false;
        const finish=(state)=>{
          if(done)return;done=true;
          const quality=video.getVideoPlaybackQuality();
          window.__TAURI_INTERNALS__.invoke('complete',{result:{state,nativeWebView2:true,system:true,deviceWrites:0,
            width:video.videoWidth,height:video.videoHeight,elapsedMs:Math.round(performance.now()-started),
            presentedFrames:quality.totalVideoFrames,droppedFrames:quality.droppedVideoFrames,errorCode:video.error?.code??null}});
        };
        video.addEventListener('error',()=>finish('mediaError'),{once:true});
        try{
          const file=await window.__TAURI_INTERNALS__.invoke('sample');
          video.src=URL.createObjectURL(new Blob([file],{type:'video/mp4'}));
        }catch{finish('fixtureReadFailed');return;}
        video.play().catch(()=>finish('playRejected'));
        if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(()=>finish('playing'));
        else video.addEventListener('timeupdate',()=>finish('playing'),{once:true});
        let checks=0;
        const timer=setInterval(()=>{
          if(done||checks++>=80){clearInterval(timer);if(!done)finish('timeout');return;}
          if(video.getVideoPlaybackQuality().totalVideoFrames>0&&video.readyState>=2)finish('playing');
        },100);
    },{once:true});"#;
    tauri::Builder::default()
        .manage(PathBuf::from(output))
        .manage(Arc::<[u8]>::from(file))
        .invoke_handler(tauri::generate_handler![complete,sample])
        .setup(move|app|{
            tauri::WebviewWindowBuilder::new(app,"main",tauri::WebviewUrl::App("index.html".into()))
                .visible(false).initialization_script(probe).build()?;
            Ok(())
        }).run(context).expect("native system media probe");
}
