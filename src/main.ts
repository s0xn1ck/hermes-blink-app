import './style.css'
import { G2HermesApp } from './app'
import { createG2Bridge, createPreviewBridge } from './g2Bridge'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('#app not found')

const preview = new URLSearchParams(window.location.search).get('preview') === '1'

Promise.resolve(preview ? createPreviewBridge() : createG2Bridge())
  .then((bridge) => new G2HermesApp(bridge, root).start())
  .catch((error) => {
    const pre = document.createElement('pre')
    pre.className = 'error'
    pre.textContent = String(error?.message ?? error)
    root.replaceChildren(pre)
  })
