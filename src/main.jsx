import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

/* The service worker is registered after first paint so a stale cache never
 * decides what the first launch looks like. Cache-first for static assets:
 * the launch right after a deploy still shows the old build, the next one
 * shows the new one. See memory: pwa stale first launch. */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
