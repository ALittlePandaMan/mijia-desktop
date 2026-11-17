import {element,button} from './dom';
import {deviceWait} from './device-loading';
import {DeviceOpening} from '../device-opening';
/** Exact lx32 official guide from vendor10598/11774. No copied media and no
 * account cookie/header injection. Keep this node mounted while it plays. */
export const purifierGuideUrl='https://cnbj2.fds.api.xiaomi.com/react-plugin/watercleaner/filter_lx32.mp4';
export function purifierGuidePage(back:()=>void,artwork:()=>HTMLElement,source=purifierGuideUrl){
 const node=element('div','device-stage'),page=element('section','device-page page-purifier-guide'),video=element('video','purifier-guide-video'),close=button('','page-icon-button',()=>{dispose();back();},'back');close.setAttribute('aria-label','返回设备设置');
 video.controls=true;video.loop=true;video.autoplay=true;video.playsInline=true;video.preload='metadata';video.disablePictureInPicture=true;video.setAttribute('controlsList','nodownload noremoteplayback');video.setAttribute('aria-label','滤芯安装指导视频');
 const feedback=element('div','purifier-guide-feedback');let disposed=false,failed=false;
 const opening=new DeviceOpening(()=>{if(!disposed&&!failed)feedback.hidden=!opening.showing;});
 const waiting=()=>{if(disposed||failed||opening.waiting)return;feedback.replaceChildren(deviceWait(artwork,'滤芯安装指导',false));feedback.hidden=true;opening.begin();};
 const load=()=>{if(disposed)return;failed=false;waiting();video.src=source;video.load();};
 video.addEventListener('loadeddata',()=>opening.ready());video.addEventListener('canplay',()=>opening.ready());video.addEventListener('waiting',waiting);video.addEventListener('error',()=>{if(disposed)return;failed=true;opening.cancel();feedback.hidden=false;feedback.replaceChildren(element('p','','视频暂时无法播放，请检查网络后重试。'),button('重新加载','purifier-read',load,'refresh'));});
 function dispose(){if(disposed)return;disposed=true;opening.cancel();video.pause();video.removeAttribute('src');video.load();}
 page.append(video,element('header','device-page-header',close),feedback);node.append(page);load();return{node,dispose};
}
