import type {AppUpdateStatus} from './application-settings';
export function updateCheckMessage(status:AppUpdateStatus):string|undefined{
 if(status.state==='current')return '当前已是最新版本。';
 if(status.state==='available'&&status.latestVersion)return `发现新版本 v${status.latestVersion.replace(/^v/,'')}，可以更新。`;
 if(status.state==='error')return '检查更新失败，请重试。';
}
