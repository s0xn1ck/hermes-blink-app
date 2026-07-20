import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { deriveDeviceBindingId } from './deviceIdentity'

export type G2Event = 'tap' | 'doubleTap' | 'swipeUp' | 'swipeDown'

export type G2Bridge = {
  showText(content: string): Promise<void>
  deviceBindingId(): Promise<string>
  onEvent(handler: (event: G2Event) => void | Promise<void>): void
  exit(): Promise<void>
}

export function createPreviewBridge(onText: (content: string) => void = console.debug): G2Bridge {
  return {
    async showText(content: string) {
      onText(content)
    },
    async deviceBindingId() {
      return 'preview-device'
    },
    onEvent() {},
    async exit() {},
  }
}

export async function createG2Bridge(): Promise<G2Bridge> {
  const bridge = await waitForEvenAppBridge()
  const containerID = 1
  const containerName = 'main'

  const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 4,
      containerID,
      containerName,
      content: 'Hermes Blink\n\nStarting...',
      isEventCapture: 1,
    })],
  }))

  if (result !== 0) {
    throw new Error(`createStartUpPageContainer failed: ${result}`)
  }

  return {
    async showText(content: string) {
      const ok = await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID,
        containerName,
        content,
      }))
      if (!ok) throw new Error('textContainerUpgrade failed')
    },
    async deviceBindingId() {
      const info = await bridge.getDeviceInfo() as any
      const serial = String(info?.serialNumber ?? info?.serial_number ?? info?.serial ?? '')
      return deriveDeviceBindingId(serial)
    },
    onEvent(handler) {
      let eventQueue = Promise.resolve()
      const dispatch = (mapped: G2Event) => {
        eventQueue = eventQueue
          .then(() => handler(mapped))
          .catch((error) => console.error('Hermes Blink G2 event failed', error))
      }
      bridge.onEvenHubEvent((event: any) => {
        const hasTouchEvent = Boolean(event.textEvent || event.listEvent)
        const rawEventType = event.textEvent?.eventType ?? event.listEvent?.eventType ?? event.sysEvent?.eventType
        const eventType = OsEventTypeList.fromJson(rawEventType)
        switch (eventType) {
          case OsEventTypeList.CLICK_EVENT:
            dispatch('tap')
            break
          case undefined:
            if (hasTouchEvent) dispatch('tap')
            break
          case OsEventTypeList.DOUBLE_CLICK_EVENT:
            dispatch('doubleTap')
            break
          case OsEventTypeList.SCROLL_TOP_EVENT:
            dispatch('swipeUp')
            break
          case OsEventTypeList.SCROLL_BOTTOM_EVENT:
            dispatch('swipeDown')
            break
        }
      })
    },
    async exit() {
      const ok = await bridge.shutDownPageContainer(1)
      if (!ok) throw new Error('shutDownPageContainer failed')
    },
  }
}
