// Used only by the explicit native verification example. No device commands.
import '../src/style.css';import '../src/theme.css';import '../src/login.css';import '../src/ui/app-font.css';
import {invoke} from '@tauri-apps/api/core';
import {loginPage} from '../src/ui/login-page';
import {assistantAuthorization} from '../src/ui/assistant-authorization';
import {AssistantAuthorizationController,type AssistantAuthorizationApi} from '../src/assistant-authorization';
import type {QrView,AppError} from '../src/types';
const api:AssistantAuthorizationApi={assistantStatus:(refresh=false)=>invoke('verification_status',{refresh}),startAssistantAuthorization:()=>Promise.reject({message:'此验证仅允许首次登录的一个二维码。'}),pollAssistantAuthorization:()=>Promise.reject(),cancelAssistantAuthorization:async()=>{},revokeAssistantAuthorization:()=>Promise.reject({message:'此窗口不提供解除正式授权。'})};
const controller=new AssistantAuthorizationController(api,render),root=document.querySelector<HTMLElement>('#app')!;
let loggedIn=false,qr:QrView|undefined,qrState='idle',error:AppError|undefined,serial=0;
function render(){
 root.replaceChildren();
 if(!loggedIn){root.append(loginPage({qrState,qr,error,startQr:()=>{void start();},cancelQr:()=>{void cancel();}}));return;}
 const main=document.createElement('main');main.className='settings-content';main.style.cssText='padding:36px;max-width:860px;margin:auto';
 const title=document.createElement('h1');title.textContent='米家已登录';
 const note=document.createElement('p');note.textContent='隔离验证会话：助手使用同一次扫码自动连接，不读取或改变正式账号设置，不提供设备控制。';
 main.append(title,note,assistantAuthorization(controller,true));root.append(main);
}
async function start(){const epoch=++serial;qrState='loading';error=undefined;render();try{const value=await invoke<QrView>('verification_start');if(epoch!==serial)return;qr=value;qrState='ready';render();void poll(epoch,value.attemptId);}catch(e){if(epoch===serial){qrState='error';error=e as AppError;render();}}}
async function cancel(){++serial;const id=qr?.attemptId;qr=undefined;qrState='idle';render();if(id)await invoke('verification_cancel',{attemptId:id});}
async function poll(epoch:number,attemptId:string){
 if(epoch!==serial)return;
 try{const result=await invoke<{status:string}>('verification_poll',{attemptId});if(epoch!==serial)return;
  if(result.status==='success'){loggedIn=true;qr=undefined;++serial;controller.setAccount('verification');render();}
  else if(result.status==='expired'){qrState='expired';render();}else setTimeout(()=>{void poll(epoch,attemptId);},1300);
 }catch(e){if(epoch===serial){qrState='error';error=e as AppError;render();}}
}
void invoke<boolean>('verification_session').then(value=>{loggedIn=value;if(value)controller.setAccount('verification');render();});
