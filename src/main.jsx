import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const start = () => createRoot(document.getElementById('root')).render(<App />);
// when hosted as a claude.ai artifact, wait for the viewer's hot-update hook; otherwise boot straight away
if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start();
