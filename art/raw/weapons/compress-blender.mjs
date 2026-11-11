/** Compress Blender's exported collection without rebuilding its geometry. */
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(path.resolve(process.argv[2],'package.json'));
const {NodeIO}=require('@gltf-transform/core');
const {ALL_EXTENSIONS}=require('@gltf-transform/extensions');
const {meshopt,textureCompress,join}=require('@gltf-transform/functions');
const {MeshoptEncoder}=require('meshoptimizer');
const sharp=require('sharp');
await MeshoptEncoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder});
for(const name of ['worn-iron-sword','long-knife','deserter-sword','back-scabbard','bound-club']){
 const d=await io.read(new URL('./export/'+name+'.glb',import.meta.url).pathname);
 const markers=d.getRoot().listNodes().filter(n=>['Grip','Tip'].includes(n.getName())).map(n=>({name:n.getName(),matrix:n.getWorldMatrix()}));
 await d.transform(join(),textureCompress({encoder:sharp,targetFormat:'webp',resize:[1024,1024]}),meshopt({encoder:MeshoptEncoder,level:'high'}));
 for(const m of markers) d.getRoot().listScenes()[0].addChild(d.createNode(m.name).setMatrix(m.matrix));
 await io.write(new URL('../../../client/public/assets/weapons/'+name+'.glb',import.meta.url).pathname,d);
 console.log(name);
}
