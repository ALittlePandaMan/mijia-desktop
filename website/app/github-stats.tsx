import stats from '../data/github-stats.json';
const compact=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1});
const exact=new Intl.NumberFormat('en-US');
function count(value:number){return compact.format(value).replace('K','k');}
export default function GithubStats(){
 return <ul className="github-stats" aria-label="GitHub 项目数据">
  <li aria-label={'GitHub 星标数 '+exact.format(stats.stars)}><svg className="icon stat-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/></svg><strong>{count(stats.stars)}</strong><span>星标</span></li>
  <li aria-label={'GitHub 公开发布附件累计下载 '+exact.format(stats.downloads)+' 次，含校验文件'}><svg className="icon stat-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/></svg><strong>{count(stats.downloads)}</strong><span>累计下载</span></li>
 </ul>;
}
