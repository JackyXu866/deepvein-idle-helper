import {parsePublicClient} from '../vendor/acorn.js';
import {extractGameTables} from '../data/public-tables.js';
import {runPlanning} from './planning.js';

self.onmessage=({data:{id,kind,input}})=>{
  try {const result=kind==='parse'?extractGameTables(input.source,parsePublicClient,input.data):runPlanning(input.data,input,kind==='inspect');
    self.postMessage({id,result});
  }catch(error){self.postMessage({id,error:error.message});}
};
