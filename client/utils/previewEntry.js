import * as Babel from '@babel/standalone';
import { Hook } from 'console-feed';

const consoleBuffer = [];
const LOGWAIT = 100;

const protect = require('./loop-protect.js');

const callback = (line) => {
  console.log('running');
};

Babel.registerPlugin('loopProtection', protect(LOGWAIT, callback));

// eslint-disable-next-line import/prefer-default-export
export const transform = source => Babel.transform(source, {
  plugins: ['loopProtection'],
}).code;


Hook(window.console, (log) => {
  consoleBuffer.push({
    log,
    source: 'sketch'
  });
});
setInterval(() => {
  if (consoleBuffer.length > 0) {
    window.parent.postMessage(consoleBuffer, '*');
    consoleBuffer.length = 0;
  }
}, LOGWAIT);
