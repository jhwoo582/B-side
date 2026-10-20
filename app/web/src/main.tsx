import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode는 쓰지 않는다: 개발 모드의 이중 마운트가 drei <Html>(지도 이름표)의 렌더 루트를 꼬이게 해 이름표가 사라진다
createRoot(document.getElementById('root')!).render(<App />)
