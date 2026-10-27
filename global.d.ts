declare module 'react-native-uvc-camera' {
  import { Component } from 'react';
  import { ViewProps } from 'react-native';

  export interface RNCameraProps extends ViewProps {
    type?: string;
    format?: string;
    captureAudio?: boolean;
    onCameraReady?: () => void;
    onMountError?: (error: any) => void;
    // 这里可以按需添加你需要的属性
  }

  export class RNCamera extends Component<RNCameraProps> {}
}