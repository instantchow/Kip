import { SignalKDeltaService } from './signalk-delta.service';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { IPathMetadata, IPathZoneDef } from "./app.interfaces";
import { ISignalKMeta, ISignalKMetadata } from "./signalk-interfaces";
import { AppSettingsService } from './app-settings.service';


// Used by service for zone state computing
export interface IPathZone extends IPathZoneDef {
  dataState?: number;
}

interface IMetaRegistration {
  path: string;
  meta?: ISignalKMetadata;
}

@Injectable({
  providedIn: 'root'
})
export class MetaService {

  /////////////////
  //TODO: to update meta to SK! PUT '/signalk/v1/api/vessels/self/electrical/controls/venus-0/state/meta/displayName' or whole structure.
  // it overwrites !

  private metas: Array<IMetaRegistration> = [];
  private metas$: BehaviorSubject<Array<IMetaRegistration>> = new BehaviorSubject<Array<IMetaRegistration>>([]);
  //TODO: remove and move to Delta service
  private selfurn: string;

  constructor(
    private settings: AppSettingsService,
    private delta: SignalKDeltaService
  ) {
    // Load zones from config
    const zonesConfig = this.settings.getZones();
    zonesConfig.forEach(item => {
      const zones = {zones: item.zonesDef};
      this.metas.push({
        path: item.path,
        meta: zones
      });
    });

    //TODO: this.updateZones();
    //TODO: this.updateMetas();
    this.metas$.next(this.metas);

    // Observer of Delta service Metadata updates
    this.delta.subscribeMetadataUpdates().subscribe((deltaMeta: IPathMetadata) => {
      this.setMeta(deltaMeta);
    })

    //TODO: remove and move to Delta service
    // Observer of vessel Self URN updates
    this.delta.subscribeSelfUpdates().subscribe(self => {
      this.setSelfUrn(self);
    });


    //TODO: Eventually we should load zones defined in SK and combine with appropriate UI to override with local config as neccesary. At the moment zones are rearely present in SK.
    // get sk service meta Zones info into metas[]
  }

    //TODO: remove and move to Delta service
  private setSelfUrn(value: string) {
    if ((value != "" || value != null) && value != this.selfurn) {
      console.debug('[SignalK Service] Setting self to: ' + value);
      this.selfurn = value;
    }
  }

  private setMeta(meta: IPathMetadata): void {
    let pathSelf: string = meta.path.replace(this.selfurn, 'self');
    let metaIndex = this.metas.findIndex(pathObject => pathObject.path == pathSelf);
    if (metaIndex >= 0) {
      this.metas[metaIndex].meta = {...this.metas[metaIndex].meta, ...meta.meta};
    } else { // not in our list yet. Meta update can in first. Create the path with empty source values for later update
      this.metas.push({
        path: pathSelf,
        meta: meta.meta,
      });
    }
  }

  public addZones(newPathZoneDef: IPathZoneDef) {
    // check if exists
    let metaIndex = this.metas.findIndex(item => item.path == newPathZoneDef.path);
    if (metaIndex >= 0) {
      this.metas[metaIndex].meta.zones = newPathZoneDef.zonesDef;
    } else {
      this.metas.push(newPathZoneDef);
    }
    // Compute zone state and push to observers
    //TODO: this.updateZones(newPathZoneDef.path);
    const zones = {zones: newPathZoneDef.zonesDef};
      this.metas.push({
        path: newPathZoneDef.path,
        meta: zones
      });
    this.metas$.next(this.metas);

    // Save Zone configuration
    let zonesConfig = this.settings.getZones();
    // check if exists in zone config
    let zoneConfigIndex = zonesConfig.findIndex(pathZonesDef => pathZonesDef.path == newPathZoneDef.path);
    if (zoneConfigIndex >= 0) {
      zonesConfig[zoneConfigIndex].zonesDef = newPathZoneDef.zonesDef;
    } else {
      zonesConfig.push(newPathZoneDef);
    }
    this.settings.saveZones(zonesConfig);
  }

  public deleteZones(path: string): boolean {
    // check if exists
    let metaIndex = this.metas.findIndex(item => item.path == path);
    if (metaIndex >= 0) {
      this.metas.splice(metaIndex, 1);
      this.metas$.next(this.metas);

      // check if exists in zone config
      let zonesConfig = this.settings.getZones();
      let zoneConfigIndex = zonesConfig.findIndex(item => item.path == path);
      if (zoneConfigIndex >= 0) {
        zonesConfig.splice(zoneConfigIndex,1);
        this.settings.saveZones(zonesConfig);
      }
      return true;
    } else {
      return false;
    }
  }

  public updatePathDataState() {

  }

  public updateZoneNotification(path?: string){
  // //TODO: fix
  // // Check for any zones to set state
  // let state: IZoneState = IZoneState.normal;
  // this.zones.forEach(zone => {
  //   if (zone.path != pathSelf) { return; }
  //   let lower = zone.lower || -Infinity;
  //   let upper = zone.upper || Infinity;
  //   let convertedValue = this.unitService.convertUnit(zone.unit, dataPath.value);
  //   if (convertedValue >= lower && convertedValue <= upper) {
  //     //in zone
  //     state = Math.max(state, zone.state);
  //   }
  // });
  // // if we're not in alarm, and new state is alarm, sound the alarm!
  // // @ts-ignore
  // if (state != IZoneState.normal && state != this.paths[pathIndex].state) {
  //   let stateString; // notif service needs string....
  //   let methods;
  //   switch (state) {
  //     // @ts-ignore
  //     case IZoneState.nominal:
  //       stateString = "nominal"
  //       methods = [ 'visual', 'sound' ];
  //       break;

  //     case IZoneState.emergency:
  //       stateString = "emergency"
  //       methods = [ 'visual', 'sound' ];
  //       break;

  //     // @ts-ignore
  //     case IZoneState.alarm:
  //         stateString = "alarm"
  //         methods = [ 'visual','sound' ];
  //         break;

  //     case IZoneState.warn:
  //       stateString = "warn"
  //       methods = [ 'visual', 'sound' ];
  //       break;

  //     // @ts-ignore
  //     case IZoneState.alert:
  //         stateString = "alert"
  //         methods = [ 'visual','sound' ];
  //         break;
  //   }


  //   // Send Notification
  //   this.notificationsService.addAlarm(pathSelf, {
  //     method: methods,
  //     state: stateString,
  //     message: pathSelf + ' value in ' + stateString,
  //     timestamp: Date.now().toString(),
  //   })
  // }

  // // if we're in alarm, and new state is not alarm, stop the alarm
  // // @ts-ignore
  // if (this.paths[pathIndex].state != IZoneState.normal && state == IZoneState.normal) {
  //   this.notificationsService.deleteAlarm(pathSelf);
  // }

  // this.paths[pathIndex].state = state;

  }

  public getMetasObservable(): Observable<Array<IMetaRegistration>> {
    return this.metas$.asObservable();
  }
}
