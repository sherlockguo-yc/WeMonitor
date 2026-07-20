import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// 导出 mount 函数，供 EJS 页面调用
window.mountTopologyEditor = function(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  ReactDOM.createRoot(el).render(
    React.createElement(React.StrictMode, null, React.createElement(App))
  );
};
