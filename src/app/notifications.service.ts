/**
 * This class handles both App notifications Snackbar and SignalK Notifications
 */
import { Injectable } from '@angular/core';
import { Subject, BehaviorSubject, Observable, Subscription } from 'rxjs';

import { AppSettingsService } from "./app-settings.service";
import { INotificationConfig } from './app-settings.interfaces';
import { DefaultNotificationConfig } from './config.blank.notification.const';
import { SignalKDeltaService, INotificationDelta, IStreamStatus } from './signalk-delta.service';
import { INotification } from "./app.interfaces";
import { Howl } from 'howler';

const alarmTrack = {
  1000 : 'notification', //filler
  1001 : 'alert',
  1002 : 'warn',
  1003 : 'alarm',
  1004 : 'emergency',
};

/**
 * Snack-bar notification message interface.
 */
export interface AppNotification {
  message: string;
  duration: number;
  silent: boolean;
}

/**
 * Kip Alarm object. Alarm index key is the path string. Alarm contains native SignalK Notification
 * values in and additional feature enhancing alarm properties.
 *
 * @path SignalK alarm path - Defines source of the alarm
 * @ack Optional Alarm acknowledgment property
 * @notification Native SignalK Notification message as Object INotification
 */
export interface Alarm {
  path: string;
  type: string;
  isAck: boolean;
  notification: INotification;
}

/**
 * Alarm information, some stats used
 */
export interface IAlarmInfo {
  audioSev: number;
  visualSev: number;
  alarmCount: number;
  unackCount: number;
  isMuted: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationsService {
  private notificationConfig: INotificationConfig;
  public notificationConfig$: BehaviorSubject<INotificationConfig> = new BehaviorSubject<INotificationConfig>(DefaultNotificationConfig);

  private alarms: { [path: string]: Alarm } = {}; // local array of Alarms with path as index key
  private activeAlarmsSubject = new BehaviorSubject<any>({});
  private alarmsInfo: BehaviorSubject<IAlarmInfo> = new BehaviorSubject<IAlarmInfo>({
    audioSev: 0,
    visualSev: 0,
    alarmCount: 0,
    unackCount: 0,
    isMuted: false
  });
  public snackbarAppNotifications: Subject<AppNotification> = new Subject<AppNotification>(); // for snackbar message

  // Audio Player properties
  howlPlayer: Howl;
  activeAlarmSoundtrack: number;
  activeHowlId: number;
  isHowlIdMuted: boolean = false;


  constructor(
    private appSettingsService: AppSettingsService,
    private deltaService: SignalKDeltaService,
    ) {
    // Observer of Notification service configuration
    this.appSettingsService.getNotificationServiceConfigAsO().subscribe((config: INotificationConfig) => {
      this.notificationConfig = config;
      this.notificationConfig$.next(config); // push to alrm menu
      if (this.notificationConfig.disableNotifications) {
        this.resetAlarms();
      }
      if (this.notificationConfig.sound.disableSound) {
        this.playAlarm(1000); // will stop any playing track if any
      } else {
        this.checkAlarms(); //see if any we need to start playing again
      }
    });

    // Observer of server connection status
    this.deltaService.streamEndpoint$.subscribe((streamStatus: IStreamStatus) => {
      if (streamStatus.operation === 2) {
        this.resetAlarms();
      }
    });

    // Observer of Delta Service Notification message
    this.deltaService.subscribeNotificationsUpdates().subscribe((notification: INotificationDelta) => {
      this.processNotificationDelta(notification);
    });

    // init alarm player
    this.howlPlayer = this.getPlayer(1000);
   }

  /**
   * Display Kip Snackbar notification.
   *
   * @param message Text to be displayed.
   * @param duration Display duration in milliseconds before automatic dismissal.
   * Duration value of 0 is indefinite or until use clicks Dismiss button. Defaults
   *  to 10000 of no value is provided.
   * @param silent A boolean that defines if the notification should make no sound.
   * Defaults false.
   */
  public sendSnackbarNotification(message: string, duration: number = 10000, silent: boolean = false) {
    this.snackbarAppNotifications.next({ message: message, duration: duration, silent: silent});
  }

  // TODO: add notification subscription method for widgets. They should send the data path they use to register: notifications follw data path structure eg: self.navigation.anchor.currentRadious data is self.notifications.navigation.anchor.currentRadious
  // public subscribeNotification() {}
  // public unsubscribeNotification() {}

  // public listNotifications() {}

  /**
   * Clears all Kip internal Notification Alarm system/array.
   * Used when server connection is reset/changed or the notification disabled.
   *
   * @usageNotes Internal function - Do not use.
   */
  public resetAlarms() {
    this.alarms = {};
    this.activeAlarmsSubject.next(this.alarms);
  }

  /**
   * Returns an Observable of type alarms containing alarms. Used
   * by observers whom are interested in Alarms such as Widgets and Alarm menu.
   */
  public getAlarms(): Observable<any> {
    return this.activeAlarmsSubject.asObservable();
  }

  /**
   * Add new Alarm and send
   * @param path SignalK path of the notification
   * @param notification Raw content of the notification message from SignalK server as INotification
   */
  public addAlarm(path: string, notification: INotification) {
    // TODO: Not sure we need this here... also present in processNotificationDelta()
    if (this.notificationConfig.disableNotifications) {
      return;
    }

    if (/^notifications.security./.test(path)) {
      return; // as per sbender this part is not ready in the spec - Don't add to alarms
    }

    if (path in this.alarms) {
      this.alarms[path].notification = notification;
    } else {
      let newAlarm: Alarm = {
        path: path,         // duplicate from Alarm Object key index for added scope from individual alarm context
        type: "device",
        isAck: false,
        notification: notification,
      };
      this.alarms[path] = newAlarm;
    }
    this.checkAlarms();
    this.activeAlarmsSubject.next(this.alarms);
  }

  /**
   * Update Alarm notification data (data from SignalK) only. ie. alarm.notification
   * @param path
   * @param notification
   */
  public updateAlarm(path: string, notification: INotification) {
    this.alarms[path].notification = notification;
    this.checkAlarms();
    this.activeAlarmsSubject.next(this.alarms);
  }

  /**
  * Deletes one alarm and notifies all observers
  * @param path String path for the alarm to delete
  * @return True if successful, false if path not found.
  */
  public deleteAlarm(path: string): boolean {
    if (path in this.alarms) {
      delete this.alarms[path];
      this.checkAlarms();
      this.activeAlarmsSubject.next(this.alarms);
      return true;
    }
    return false;
  }

  /**
   * Set Acknowledgement and send to other observers so they can react accordingly
   * @param path alarm to acknowledge
   * @param timeout if set will unacknowledge in this time
   * @return true if alarms found, else false
   */
  public acknowledgeAlarm(path: string, timeout: number = 0): boolean {
    if (path in this.alarms) {
      this.alarms[path].isAck = true;
      this.activeAlarmsSubject.next(this.alarms);
      if (timeout > 0) {
        setTimeout(()=>{
          console.log(`[Notification Service] Unack: ${path}`);
          if (path in this.alarms) {
            this.alarms[path].isAck = false;
            this.activeAlarmsSubject.next(this.alarms);
          }
        }, timeout);
      }
      this.checkAlarms();
      return true;
    }
    return false
  }

  /**
   * Checks all alarms for worst state, and sets any visualSev/AudioSev
   */
  public checkAlarms() {
    // find worse alarm state
    let unAckAlarms = 0;
    let audioSev = 0;
    let visualSev = 0;
    for (const [path, alarm] of Object.entries(this.alarms))
    {
      if (alarm.isAck) { continue; }
      unAckAlarms++;
      let aSev = 0;
      let vSev = 0;

      //seems INotification can sometimes not have method set. (Problem from server?)
      if (!('method' in alarm.notification)) {
        continue; // if there's no method, don't alarm...
      }

      switch (alarm.notification['state']) {
        //case 'nominal':       // not sure yet... spec not clear. Maybe only relevant for Zones
        case 'normal':        // information only ie.: engine temperature normal. Not usually displayed
          if (alarm.notification['method'].includes('sound') && !this.notificationConfig.sound.muteNormal) { aSev = 0; }
          if (alarm.notification['method'].includes('visual')) { aSev = 0; }
          break;

        case 'alert':         // user informational event ie.: auto-pilot waypoint reached, Engine Started/stopped, ect.
          if (alarm.notification['method'].includes('sound') && !this.notificationConfig.sound.muteAlert) { aSev = 1; }
          if (alarm.notification['method'].includes('visual')) { vSev = 1; }
          break;

        case 'warn':          // user attention needed ie.: auto-pilot detected Wind Shift (go check if it's all fine), bilge pump activated (check if you have an issue).
          if (alarm.notification['method'].includes('sound') && !this.notificationConfig.sound.muteWarning) { aSev = 2; }
          if (alarm.notification['method'].includes('visual')) { vSev = 1; }
          break;

        case 'alarm':         // a problem that requires immediate user attention ie.: auto-pilot can't stay on course, engine temp above specs.
          if (alarm.notification['method'].includes('sound') && !this.notificationConfig.sound.muteAlarm) { aSev = 3; }
          if (alarm.notification['method'].includes('visual')) { vSev = 2; }
          break;

        case 'emergency':     // safety threatening event ie.: MOB, collision eminent (AIS related), ran aground (water depth lower than keel draft)
          if (alarm.notification['method'].includes('sound') && !this.notificationConfig.sound.muteEmergency) { aSev = 4; }
          if (alarm.notification['method'].includes('visual')) { vSev = 2; }
          break;

        default: // we don;t know this one. Tell the user.
          aSev = 0;
          vSev = 0;
          this.sendSnackbarNotification("Unknown Notification State received from SignalK", 0, false);
          console.log("[Notification Service] Unknown Notification State received from SignalK\n" + JSON.stringify(alarm));
      }
      audioSev = Math.max(audioSev, aSev);
      visualSev = Math.max(visualSev, vSev);
    }

    if (!this.notificationConfig.sound.disableSound) {
      this.playAlarm(1000 + audioSev);
    }
    this.alarmsInfo.next({
      audioSev: audioSev,
      visualSev: visualSev,
      alarmCount: Object.keys(this.alarms).length,
      unackCount: unAckAlarms,
      isMuted: this.isHowlIdMuted
    });
  }

  /**
   * Observable to receive Kip app Snackbar notification. Use in app.component ONLY.
   *
   * @usageNotes To send a Snackbar notification, use sendSnackbarNotification().
   * Notifications are purely client side and have no relationship or
   * interactions with the SignalK server.
   */
  public getSnackbarAppNotifications() {
    return this.snackbarAppNotifications.asObservable();
  }

  // TODO: update description
  /**
   * Processes SignalK Delta metadata containing Notifications information and
   * routes to Kip Notification system as Alarms and Notifications.
   *
   * @param path path of message ie. the subject of the message
   * @param notificationValue Content of the message. Must conform to INotification interface.
   * @usageNotes This function is internal and should not be used.
   */
  public processNotificationDelta(delta: INotificationDelta) {
    if (this.notificationConfig.disableNotifications) {
      return;
    }

    if (delta.notification === null) {
      // Server sent remove/clear notification state message
      if (this.deleteAlarm(delta.path)) {
      } else {
        console.log(`[Notification Service] Unable to clear alarm. Unknown Path: ${delta.path}`);
      };
    } else {
      if (delta.path in this.alarms) {
        //already know of this alarm. Update only if different (no need to update if no change)
        if (    (this.alarms[delta.path].notification['state'] !== delta.notification['state'])
              ||(this.alarms[delta.path].notification['message'] !== delta.notification['message'])
              ||(JSON.stringify(this.alarms[delta.path].notification['method']) !== JSON.stringify(delta.notification['method'])) ) { // no easy way to compare arrays??? ok...
          this.updateAlarm(delta.path, delta.notification);
        }
      } else {
        // New Alarm, add it
        this.addAlarm(delta.path, delta.notification);
      }
    }
  }

  /**
   * Load player with a specific track in loop mode.
   * @param track track ID to play. See const for definition
   */
   getPlayer(track: number): Howl {
    this.activeAlarmSoundtrack = track;
    let player = new Howl({
        src: ['assets/' + alarmTrack[track] + '.mp3'],
        autoUnlock: true,
        autoSuspend: false,
        autoplay: false,
        preload: true,
        loop: true,
        onend: function() {
          // console.log('Finished!');
        },
        onloaderror: function() {
          console.log("[Notification Service] Player onload error");
        },
        onplayerror: function() {
          console.log("[Notification Service] Player locked");
          this.howlPlayer.once('unlock', function() {
            this.howlPlayer.play();
          });
        }
      });
    return player;
  }

  /**
  * mute Howl Player active track ei.: howlId. Note Howl howlId is not the
  * same as Player Soundtrack TrackId which represents the selected sound file.
  * @param state sound muted boolean state
  */
  mutePlayer(state) {
    this.howlPlayer.mute(state, this.activeHowlId);
    this.isHowlIdMuted = state;
    this.checkAlarms(); //make sure to push updated info to alarm menu
  }

  /**
   * play audio notification sound
   * @param trackId track to play
   */
  playAlarm(trackId: number) {
    if (this.activeAlarmSoundtrack == trackId) {   // same track, do nothing
      return;
    }
    if (trackId == 1000) {   // Stop track
      if (this.howlPlayer) {
        this.howlPlayer.stop();
      }
      this.activeAlarmSoundtrack = 1000;
      return;
    }
    this.howlPlayer.stop();
    this.howlPlayer = this.getPlayer(trackId);
    this.activeHowlId = this.howlPlayer.play();
  }

  public getAlarmInfoAsO(): Observable<IAlarmInfo> {
    return this.alarmsInfo.asObservable();
  }

  public getNotificationServiceConfigAsO(): Observable<INotificationConfig> {
    return this.notificationConfig$.asObservable();
  }
}
