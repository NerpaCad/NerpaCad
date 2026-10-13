import { render } from 'preact'
import './themes'
import { App } from './ui/App'
import { initMods } from './ui/mods'
import './styles.css'

// the mods' robots are known before any project is shown or built
void initMods().finally(() => render(<App />, document.getElementById('app')!))
