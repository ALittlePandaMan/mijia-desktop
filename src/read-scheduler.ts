/** In-flight deduplication only. No response, credential or session cache. */
export class ReadScheduler {
  private epoch=0;
  private active=0;
  private pending=new Map<string,Promise<unknown>>();
  private queue:Array<{run:()=>void;cancel:()=>void}>=[];
  constructor(private readonly limit=4,private readonly capacity=128){}
  reset():void {
    ++this.epoch;this.pending.clear();
    for(const job of this.queue.splice(0))job.cancel();
  }
  read<T>(key:string,send:()=>Promise<T>):Promise<T>{
    const existing=this.pending.get(key);if(existing)return existing as Promise<T>;
    if(this.pending.size>=this.capacity)return Promise.reject({kind:'busy',message:'读取队列繁忙，请稍后重试。',retryable:true});
    const epoch=this.epoch;
    const result=new Promise<T>((resolve,reject)=>{
      const stale=()=>reject({kind:'staleContext',message:'读取上下文已变化。',retryable:false});
      const run=()=>{
        if(epoch!==this.epoch){stale();return;}
        ++this.active;
        void Promise.resolve().then(send).then(value=>epoch===this.epoch?resolve(value):stale(),reject).finally(()=>{
          --this.active;this.drain();
        });
      };
      this.queue.push({run,cancel:stale});
    });
    this.pending.set(key,result);
    void result.finally(()=>{if(this.pending.get(key)===result)this.pending.delete(key);}).catch(()=>{});
    this.drain();return result;
  }
  private drain():void{while(this.active<this.limit&&this.queue.length)this.queue.shift()!.run();}
}
