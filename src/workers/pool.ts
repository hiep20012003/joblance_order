import Piscina from 'piscina';
import path from 'path';

export const workerPool = new Piscina({
  filename: path.resolve(__dirname, './process-picture.js'),
  maxThreads: 10, 
});
