import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from './lib/i18n'
import './index.css'
import App from './App.jsx'

// The language wraps everything, including the router: a screen cannot render a
// word before it knows which language to say it in.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
