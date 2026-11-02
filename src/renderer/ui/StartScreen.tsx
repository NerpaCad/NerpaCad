/**
 * The start screen: the projects opened and saved last, each with a picture, to go back to with
 * one click; a new project or another file. Shown when the app opens on an empty project and
 * there are recent ones, and from the "…" menu.
 */
import { lang, t } from '../i18n'
import * as A from './actions'
import { Icon } from './icons'

const when = (at: number) =>
  new Date(at).toLocaleString(lang.value === 'zh' ? 'zh-CN' : lang.value === 'en' ? 'en-GB' : 'ru-RU', { dateStyle: 'medium', timeStyle: 'short' })

export function StartScreen() {
  const list = A.recentProjects.value
  const close = () => (A.startScreen.value = false)
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="modal start-screen" data-testid="start-screen">
        <div class="modal-head">
          <h2>{t('start.title')}</h2>
          <button class="icon-btn" title={t('about.close')} onClick={close} data-testid="start-close">
            <Icon.close size={16} />
          </button>
        </div>
        <div class="start-actions">
          <button class="btn primary" onClick={close} data-testid="start-new">
            {t('start.new')}
          </button>
          <button
            class="btn"
            onClick={() => {
              close()
              void A.openProject()
            }}
            data-testid="start-open"
          >
            {t('start.open')}
          </button>
        </div>
        {list.length === 0 ? (
          <p class="muted">{t('start.none')}</p>
        ) : (
          <div class="recent-grid">
            {list.map((r) => (
              <div class={`recent-card ${r.missing ? 'missing' : ''}`} data-testid="recent-card" title={r.path}>
                <button class="recent-open" disabled={r.missing} onClick={() => void A.openRecent(r.path)}>
                  <div class="recent-thumb">{r.thumb ? <img src={r.thumb} alt="" /> : <Icon.shapes size={40} />}</div>
                  <div class="recent-name">{r.name.replace(/\.(nerpa|tcad)$/i, '')}</div>
                  <div class="recent-when">{r.missing ? t('start.missingShort') : when(r.at)}</div>
                </button>
                <button class="recent-forget" title={t('start.forget')} onClick={() => void A.forgetRecent(r.path)} data-testid="recent-forget">
                  <Icon.close size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
