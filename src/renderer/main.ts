import './styles/fonts.css'
import App from './App.svelte'
import { mount } from 'svelte'
import { platform } from './lib/platform'

// Stamp the OS platform for CSS (titlebar insets differ per platform)
document.documentElement.dataset.platform = platform()

const app = mount(App, {
  target: document.getElementById('app')!
})

export default app
