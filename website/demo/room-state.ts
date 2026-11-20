/** Device simulation shared by both browser previews; never persisted. */
export interface RoomState {
  mainLight: boolean;
  switchStrip: boolean;
  switchDownlights: boolean;
  lightOn: boolean;
  brightness: number;
  colorTemperature: number;
  curtainPosition: number;
  curtainTarget: number;
  curtainMoving: boolean;
  fanOn: boolean;
  fanSpeed: number;
  fanSwing: boolean;
  fanMode: number;
  acOn: boolean;
  acTarget: number;
  acMode: number;
  acFan: number;
  temperature: number;
  humidity: number;
  tvOn: boolean;
  tvVolume: number;
  tvSelection: number;
  tvScreen: string;
  airerPosition: number;
  airerLight: boolean;
  airerBrightness: number;
  airerTarget: number;
  airerStatus: number;
  washerOn: boolean;
  washerProgram: number;
  washerStatus: number;
  washerRemaining: number;
  washerLocked: boolean;
}
