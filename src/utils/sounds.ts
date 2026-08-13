// Sound Effects Utility for Sinta Coffee Shop
// Creates pleasant, professional audio feedback for various actions

type SoundType = 
  | 'order-new'       // New order received
  | 'order-serving'   // Order moved to serving
  | 'order-complete'  // Order completed
  | 'payment-received' // Payment confirmed
  | 'error'           // Error/warning
  | 'button-click'    // Subtle UI feedback
  | 'success'         // General success action
  | 'notification';   // General notification

interface SoundConfig {
  frequency: number;
  duration: number;
  type: OscillatorType;
  volume: number;
  pattern?: 'single' | 'double' | 'ascending' | 'descending';
}

const soundConfigs: Record<SoundType, SoundConfig> = {
  'order-new': {
    frequency: 523.25, // C5
    duration: 0.4,
    type: 'sine',
    volume: 0.08,
    pattern: 'ascending'
  },
  'order-serving': {
    frequency: 659.25, // E5
    duration: 0.3,
    type: 'sine',
    volume: 0.06,
    pattern: 'single'
  },
  'order-complete': {
    frequency: 783.99, // G5
    duration: 0.5,
    type: 'sine',
    volume: 0.07,
    pattern: 'descending'
  },
  'payment-received': {
    frequency: 880, // A5
    duration: 0.35,
    type: 'triangle',
    volume: 0.06,
    pattern: 'double'
  },
  'error': {
    frequency: 196, // G3
    duration: 0.3,
    type: 'sawtooth',
    volume: 0.05,
    pattern: 'descending'
  },
  'button-click': {
    frequency: 1046.5, // C6
    duration: 0.05,
    type: 'sine',
    volume: 0.03,
    pattern: 'single'
  },
  'success': {
    frequency: 659.25, // E5
    duration: 0.25,
    type: 'sine',
    volume: 0.05,
    pattern: 'ascending'
  },
  'notification': {
    frequency: 523.25, // C5
    duration: 0.2,
    type: 'sine',
    volume: 0.04,
    pattern: 'single'
  }
};

class SoundManager {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = true;
  private volumeMultiplier: number = 1.0;

  constructor() {
    this.init();
  }

  private init() {
    // Check localStorage for sound preference
    const savedPreference = localStorage.getItem('sinta-sound-enabled');
    this.enabled = savedPreference !== 'false';

    // Initialize AudioContext on user interaction
    const initAudio = () => {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      document.removeEventListener('click', initAudio);
      document.removeEventListener('touchstart', initAudio);
    };

    document.addEventListener('click', initAudio);
    document.addEventListener('touchstart', initAudio);
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    localStorage.setItem('sinta-sound-enabled', String(enabled));
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setVolume(multiplier: number) {
    this.volumeMultiplier = Math.max(0, Math.min(1, multiplier));
  }

  public play(soundType: SoundType): void {
    if (!this.enabled || !this.audioContext) return;

    const config = soundConfigs[soundType];
    const now = this.audioContext.currentTime;

    const playTone = (freq: number, startTime: number, vol: number) => {
      const oscillator = this.audioContext!.createOscillator();
      const gainNode = this.audioContext!.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext!.destination);

      oscillator.type = config.type;
      oscillator.frequency.setValueAtTime(freq, startTime);

      const adjustedVolume = vol * this.volumeMultiplier * config.volume;
      gainNode.gain.setValueAtTime(adjustedVolume, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + config.duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + config.duration);
    };

    switch (config.pattern) {
      case 'ascending':
        playTone(config.frequency, now, 1.0);
        playTone(config.frequency * 1.25, now + 0.12, 0.8); // Major third up
        break;
      case 'descending':
        playTone(config.frequency, now, 1.0);
        playTone(config.frequency * 0.8, now + 0.12, 0.8); // Minor third down
        break;
      case 'double':
        playTone(config.frequency, now, 1.0);
        playTone(config.frequency, now + 0.15, 1.0);
        break;
      case 'single':
      default:
        playTone(config.frequency, now, 1.0);
        break;
    }
  }

  // Convenience methods
  public playOrderNew() { this.play('order-new'); }
  public playOrderServing() { this.play('order-serving'); }
  public playOrderComplete() { this.play('order-complete'); }
  public playPaymentReceived() { this.play('payment-received'); }
  public playError() { this.play('error'); }
  public playButtonClick() { this.play('button-click'); }
  public playSuccess() { this.play('success'); }
  public playNotification() { this.play('notification'); }
}

// Export singleton instance
export const soundManager = new SoundManager();

// Hook for React components
import { useEffect, useCallback } from 'react';

export function useSound(enabled: boolean) {
  useEffect(() => {
    soundManager.setEnabled(enabled);
  }, [enabled]);

  const play = useCallback((soundType: SoundType) => {
    soundManager.play(soundType);
  }, []);

  return {
    play,
    playOrderNew: () => soundManager.playOrderNew(),
    playOrderServing: () => soundManager.playOrderServing(),
    playOrderComplete: () => soundManager.playOrderComplete(),
    playPaymentReceived: () => soundManager.playPaymentReceived(),
    playError: () => soundManager.playError(),
    playButtonClick: () => soundManager.playButtonClick(),
    playSuccess: () => soundManager.playSuccess(),
    playNotification: () => soundManager.playNotification(),
  };
}
