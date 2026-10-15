import { parseHTML } from '../parser';

// This worker only compiles. Generated code is executed in the preview frame.
self.onmessage = (event: MessageEvent<{ source: string }>): void => {
  self.postMessage(
    parseHTML(event.data.source, {
      mode: 'component',
      outputFormat: 'esm',
      strictMode: true,
    })
  );
};
