import base from '../vite.config.ts';

export default {
  ...base,
  plugins: [...base.plugins, {
    name: 'pr18-native-viewport-diagnostics',
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module', src: '/__pr18_metrics.js' }, injectTo: 'body' }];
    },
    configureServer(server) {
      server.middlewares.use('/__pr18_metrics.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(`const badge = document.createElement('output');
          badge.style.cssText = 'position:fixed;bottom:40px;right:8px;z-index:2147483647;background:#fff;color:#000;font:14px monospace;padding:6px;pointer-events:none';
          document.body.append(badge);
          function update() { badge.textContent = 'DIAGNOSTIC client=' + innerWidth + 'x' + innerHeight + ' DPR=' + devicePixelRatio + ' visualScale=' + visualViewport.scale; }
          addEventListener('resize', update); setInterval(update, 500); update();`);
      });
    },
  }],
};
