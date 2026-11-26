// Minisign format used by Tauri's updater: Ed25519 + BLAKE2b-512, with
// a separately signed trusted comment. Package inspection never runs the app.
import fs from 'node:fs';
import {createHash,createPublicKey,verify} from 'node:crypto';
export function verifyUpdateSignature(file,encoded,version){
 const config=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
 const keyText=Buffer.from(config.plugins.updater.pubkey,'base64').toString('utf8').trim().split(/\r?\n/);
 const lines=Buffer.from(encoded.trim(),'base64').toString('utf8').trim().split(/\r?\n/);
 if(lines.length!==4||!lines[2].startsWith('trusted comment: '))throw Error('Invalid updater signature format.');
 const publicKey=Buffer.from(keyText[1]??'','base64'),signature=Buffer.from(lines[1]??'','base64'),global=Buffer.from(lines[3]??'','base64');
 if(publicKey.length!==42||signature.length!==74||global.length!==64||signature.subarray(0,2).toString('ascii')!=='ED'||!publicKey.subarray(2,10).equals(signature.subarray(2,10)))throw Error('Updater signature algorithm or key mismatch.');
 const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),publicKey.subarray(10)]),format:'der',type:'spki'});
 const comment=lines[2].slice('trusted comment: '.length),raw=signature.subarray(10);
 const digest=createHash('blake2b512').update(fs.readFileSync(file)).digest();
 if(!verify(null,digest,key,raw)||!verify(null,Buffer.concat([raw,Buffer.from(comment)]),key,global))throw Error('Updater package signature verification failed.');
 if(comment.split('\t').find(field=>field.startsWith('version:'))!==`version:${version}`)throw Error('Updater signature version mismatch.');
}
