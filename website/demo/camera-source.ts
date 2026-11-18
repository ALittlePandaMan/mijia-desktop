/** User-requested camera stills; no video, account, or device-session dependency. */
export interface CameraFrameSource {
 setVisible(visible:boolean):void;
 renderCamera(index:number,target:HTMLCanvasElement,width:number,height:number,pan:number,tilt:number):void;
 ready(index:number):boolean;
 dispose():void;
}
export const cameraNames=['二楼室外','二楼室内','一楼室内','室外'];
const scenes=['factory-three','factory-four','factory-one','factory-two'];
export class ImageFrameSource implements CameraFrameSource {
 private images:HTMLImageElement[]=[];private disposed=false;
 constructor(private changed:()=>void){}
 setVisible(visible:boolean){
  if(!visible||this.images.length||this.disposed)return;
  this.images=scenes.map(id=>{const image=new Image();image.decoding='async';image.addEventListener('load',()=>{if(!this.disposed)this.changed();});image.addEventListener('error',()=>{if(!this.disposed)this.changed();});image.src='../demo-media/'+id+'.jpg';return image;});
 }
 ready(index:number){const image=this.images[index];return !!image?.complete&&image.naturalWidth>0;}
 renderCamera(index:number,target:HTMLCanvasElement,width:number,height:number,pan:number,tilt:number){
  if(target.width!==width||target.height!==height){target.width=width;target.height=height;}
  const context=target.getContext('2d');if(!context)return;context.fillStyle='#000';context.fillRect(0,0,width,height);const image=this.images[index];
  if(!this.ready(index)){context.fillStyle='#c4d5ca';context.font=`${Math.max(14,Math.round(height/28))}px MiSans,sans-serif`;context.textAlign='center';context.fillText(image?.complete?'图片暂不可用':'正在加载图片',width/2,height/2);return;}
  const px=Math.max(-70,Math.min(70,pan))/70,py=Math.max(-35,Math.min(35,tilt))/35;
  const sw=image.naturalWidth,sh=image.naturalHeight,zoom=1+.14*Math.max(Math.abs(px),Math.abs(py)),aspect=width/height,cropWidth=Math.min(sw,sh*aspect)/zoom,cropHeight=cropWidth/aspect;
  const x=(sw-cropWidth)*(1+px)/2,y=(sh-cropHeight)*(1-py)/2;
  context.drawImage(image,x,y,cropWidth,cropHeight,0,0,width,height);
 }
 dispose(){this.disposed=true;this.images=[];}
}
