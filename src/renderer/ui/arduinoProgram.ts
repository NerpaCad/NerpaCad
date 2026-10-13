/** The Arduino's block program as a source for the block editor, with its C++ view. */
import { computed } from '@preact/signals'
import { arduinoCode } from '../core/circuit/codegen'
import { circuitActive, circuitSerial, circuitState, programArduino } from '../core/circuit/state'
import { t } from '../i18n'
import type { ProgramSource } from './BlocklyPanel'
import { arduinoToolbox } from './blocks'
import { setArduinoProgram } from './circuitActions'

export const arduinoProgram: ProgramSource = {
  target: computed(() => {
    const a = programArduino.value
    return a ? { id: a.id, name: t('ckt.part.arduino'), program: a.program } : null
  }),
  save: setArduinoProgram,
  active: circuitActive,
  locked: computed(() => circuitState.value === 'running'),
  toolbox: arduinoToolbox,
  empty: 'ckt.addArduinoFirst',
  serial: circuitSerial,
  code: (p) =>
    arduinoCode(p, { setup: '', loop: t('ckt.codeEmptyLoop'), wait: t('ckt.codeWait'), unsupported: t('ckt.codeUnsupported') })
}
