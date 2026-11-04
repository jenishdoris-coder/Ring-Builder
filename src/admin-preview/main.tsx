import React from 'react';
import ReactDOM from 'react-dom/client';
import StudioApp from '../admin/StudioApp';
import '../styles/style.css';
document.documentElement.dataset.adminPreview='true';
ReactDOM.createRoot(document.getElementById('canvas-container')!).render(<React.StrictMode><StudioApp preview/></React.StrictMode>);
