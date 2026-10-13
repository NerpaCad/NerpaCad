import { describe, expect, it } from 'vitest'
import { emptyDoc, sceneNodes } from '@/core/doc/model'
import { parseDoc, serializeDoc, FileFormatError } from '@/core/io/formats'
import { lampNode, nerpaNode, robotNode, workspaceJson, start } from '@/core/robotics/demo'

describe('.nerpa files with lamps, seals and all kinds of pad devices', () => {
  const field = () => {
    const r = robotNode(0, 0, 0, 'R')
    r.params.robot!.sensors = [
      { port: 1, type: 'light' },
      { port: 2, type: 'ultrasonic' },
      { port: 3, type: 'touch' },
      { port: 4, type: 'flashlight' },
      { port: 5, type: 'line' }
    ]
    const program = workspaceJson([start([])])
    return { ...emptyDoc(), scene: 'robo' as const, nodes: [r, lampNode('spot', 300, 0, 'L'), nerpaNode(0, 300, 90, 'N', program)] }
  }

  it('round-trip', () => {
    const d = field()
    const back = parseDoc(serializeDoc(d))
    const robo = sceneNodes(back, 'robo')
    expect(robo.map((n) => n.kind === 'prim' && n.prim)).toEqual(['robot', 'light', 'nerpa'])
    expect(robo[0].kind === 'prim' && robo[0].params.robot!.sensors.map((s) => s.type)).toEqual(['light', 'ultrasonic', 'touch', 'flashlight', 'line'])
    expect(robo[1].kind === 'prim' && robo[1].params.light).toEqual(d.nodes[1].kind === 'prim' && d.nodes[1].params.light)
    expect(robo[1].transform.position[2]).toBe(200)
    expect(robo[2].kind === 'prim' && robo[2].params.nerpa!.program).toBeTruthy()
  })

  it('rejects bad lamps, seals and devices, and keeps them out of the 3D scene', () => {
    const bad = (mutate: (d: ReturnType<typeof field>) => void) => {
      const d = field()
      mutate(d)
      return () => parseDoc(serializeDoc(d))
    }
    expect(bad((d) => ((d.nodes[0] as any).params.robot.sensors[0].type = 'laser'))).toThrow(FileFormatError)
    expect(bad((d) => ((d.nodes[1] as any).params.light.kind = 'laser'))).toThrow(FileFormatError)
    expect(bad((d) => ((d.nodes[1] as any).params.light.brightness = 'a lot'))).toThrow(FileFormatError)
    expect(bad((d) => ((d.nodes[2] as any).params.nerpa = null))).toThrow(FileFormatError)
    // out-of-range values are clamped, not refused
    const d = field()
    ;(d.nodes[1] as any).params.light.brightness = 500
    const back = sceneNodes(parseDoc(serializeDoc(d)), 'robo')
    expect(back[1].kind === 'prim' && back[1].params.light!.brightness).toBe(100)
    // a seal in the 3D model is refused
    const m = { ...emptyDoc(), nodes: [nerpaNode(0, 0, 0, 'N')] }
    expect(() => parseDoc(serializeDoc(m))).toThrow(FileFormatError)
  })
})
