/** Add the socket contract to the existing staff without changing its geometry. */
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(path.resolve(process.argv[2],'package.json'));
const {NodeIO}=require('@gltf-transform/core');
const {ALL_EXTENSIONS}=require('@gltf-transform/extensions');
const {MeshoptDecoder,MeshoptEncoder}=require('meshoptimizer');
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const file=new URL('../../../client/public/assets/weapons/staff.glb',import.meta.url).pathname;
const d=await io.read(file);
if(!d.getRoot().listNodes().some(n=>n.getName()==='Grip')){
 const scene=d.getRoot().listScenes()[0];
 scene.addChild(d.createNode('Grip'));
 scene.addChild(d.createNode('Tip').setTranslation([0,.85,0]));
 await io.write(file,d);
}
