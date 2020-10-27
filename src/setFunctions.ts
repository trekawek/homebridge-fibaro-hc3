//    Copyright 2020 ilcato
// 
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
// 
//        http://www.apache.org/licenses/LICENSE-2.0
// 
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

// Fibaro Home Center 2 Platform plugin for HomeBridge

'use strict'

export const lowestTemp = 12;
export const stdTemp = 21;

export class SetFunctions {
	hapCharacteristic: any;
	setFunctionsMapping: Map<string, any>;
	getTargetSecuritySystemSceneMapping: Map<number, any>;

	platform: any;

	constructor(hapCharacteristic, platform) {
		this.hapCharacteristic = hapCharacteristic;
		this.platform = platform;

		this.setFunctionsMapping = new Map([
			[(new hapCharacteristic.On()).UUID, this.setOn],
			[(new hapCharacteristic.Brightness()).UUID, this.setBrightness],
			[(new hapCharacteristic.TargetPosition()).UUID, this.setTargetPosition],
			[(new hapCharacteristic.TargetHorizontalTiltAngle()).UUID, this.setTargetTiltAngle],
			[(new hapCharacteristic.LockTargetState()).UUID, this.setLockTargetState],
			[(new hapCharacteristic.TargetHeatingCoolingState()).UUID, this.setTargetHeatingCoolingState],
			[(new hapCharacteristic.TargetTemperature()).UUID, this.setOverrideTemperature],
			[(new hapCharacteristic.TargetDoorState()).UUID, this.setTargetDoorState],
			[(new hapCharacteristic.Hue()).UUID, this.setHue],
			[(new hapCharacteristic.Saturation()).UUID, this.setSaturation],
			[(new hapCharacteristic.SecuritySystemTargetState()).UUID, this.setSecuritySystemTargetState],
		]);

		this.getTargetSecuritySystemSceneMapping = new Map([
			[this.hapCharacteristic.SecuritySystemTargetState.AWAY_ARM, this.platform.securitySystemScenes.SetAwayArmed],
			[this.hapCharacteristic.SecuritySystemTargetState.DISARM, this.platform.securitySystemScenes.SetDisarmed],
			[this.hapCharacteristic.SecuritySystemTargetState.NIGHT_ARM, this.platform.securitySystemScenes.SetNightArmed],
			[this.hapCharacteristic.SecuritySystemTargetState.STAY_ARM, this.platform.securitySystemScenes.SetStayArmed]
		]);

	}


	setOn(value, callback, context, characteristic, service, IDs) {
		if (service.isVirtual && !service.isGlobalVariableSwitch) {
			// It's a virtual device so the command is pressButton and not turnOn or Off
			this.command("pressButton", [IDs[1]], service, IDs, callback);
			// In order to behave like a push button reset the status to off
			setTimeout(() => {
				characteristic.setValue(0, undefined, 'fromSetValue');
			}, 100);
		} else if (service.isGlobalVariableSwitch) {
			this.setGlobalVariable(IDs[1], value == true ? "true" : "false", callback);
		} else if (service.isHarmonyDevice) {
			this.command("changeActivityState", null, service, IDs, callback);
			//			setTimeout(() => {
			//				this.command("changeActivityState", null, service, IDs, callback);	// bug in Fibaro plugin: need to call 2 times
			//			}, 10000);
		} else {
			//			if (characteristic.value == true && value == 0 || characteristic.value == false && value == 1)
			this.command(value == 0 ? "turnOff" : "turnOn", null, service, IDs, callback);
		}
	}
	async setBrightness(value, callback, context, characteristic, service, IDs) {
		if (service.HSBValue != null) {
			;
			let rgb = this.updateHomeCenterColorFromHomeKit(null, null, value, service);
			this.syncColorCharacteristics(rgb, service, IDs, callback);
		} else {
			try {
				const properties = await this.platform.fibaroClient.getDeviceProperties(IDs[0]);
				if (properties.state)
					this.command("setValue", [value], service, IDs, callback);
				else {
					callback();
				}
			} catch (e) {
				this.platform.log("There was a problem getting value from: ", `${IDs[0]} - Err: ${e}`);
			}
		}
	}
	setTargetPosition(value, callback, context, characteristic, service, IDs) {
		this.command("setValue", [value], service, IDs, callback);
	}
	setTargetTiltAngle(angle, callback, context, characteristic, service, IDs) {
		let value2 = SetFunctions.scale(angle, characteristic.props.minValue, characteristic.props.maxValue, 0, 100);
		this.command("setValue2", [value2], service, IDs, callback);
	}
	setLockTargetState(value, callback, context, characteristic, service, IDs) {
		if (service.isLockSwitch) {
			var action = (value == this.hapCharacteristic.LockTargetState.UNSECURED) ? "turnOn" : "turnOff";
			this.command(action, null, service, IDs, callback);
			let lockCurrentStateCharacteristic = service.getCharacteristic(this.hapCharacteristic.LockCurrentState);
			lockCurrentStateCharacteristic.updateValue(value, undefined, 'fromSetValue');
			return;
		}

		var action = (value == this.hapCharacteristic.LockTargetState.UNSECURED) ? "unsecure" : "secure";
		this.command(action, [0], service, IDs, callback);
		setTimeout(() => {
			let lockCurrentStateCharacteristic = service.getCharacteristic(this.hapCharacteristic.LockCurrentState);
			lockCurrentStateCharacteristic.updateValue(value, undefined, 'fromSetValue');
		}, 1000);
		// check if the action is correctly executed by reading the state after a specified timeout. If the lock is not active after the timeout an IFTTT message is generated
		if (this.platform.config.doorlocktimeout != "0") {
			var timeout = parseInt(this.platform.config.doorlocktimeout) * 1000;
			setTimeout(() => {
				this.checkLockCurrentState(IDs, value);
			}, timeout);
		}
	}
	setTargetDoorState(value, callback, context, characteristic, service, IDs) {
		var action = value == 1 ? "close" : "open";
		this.command(action, [0], service, IDs, callback);
		setTimeout(() => {
			characteristic.setValue(value, undefined, 'fromSetValue');
			// set also current state
			let currentDoorStateCharacteristic = service.getCharacteristic(this.hapCharacteristic.CurrentDoorState);
			currentDoorStateCharacteristic.setValue(value, undefined, 'fromSetValue');
		}, 100);
	}
	setTargetHeatingCoolingState(value, callback, context, characteristic, service, IDs) {
		var v;
		switch (value) {
			case this.hapCharacteristic.TargetHeatingCoolingState.OFF:
				v = "Off";
				break;
			case this.hapCharacteristic.TargetHeatingCoolingState.HEAT:
				v = "Heat";
				break;
			case this.hapCharacteristic.TargetHeatingCoolingState.COOL:
				v = "Off";
				break;
			case this.hapCharacteristic.TargetHeatingCoolingState.AUTO:
				v = "Heat";
				break;
			default:
				return;
		}
		this.command("setThermostatMode", [v], service, IDs, callback);
	}
	setOverrideTemperature(value, callback, context, characteristic, service, IDs) {
		if (Math.abs(value - characteristic.value) >= 0.5) {
			value = parseFloat((Math.round(value / 0.5) * 0.5).toFixed(1));
			this.command("setOverrideSchedule", [
				{"type":"thermostat", "data":{"setpoints":[{"type":"Heating","unit":"C","value":value}], "mode":"Heat"}},
				{"type":"Minutes", "value": parseInt(this.platform.config.thermostattimeout) / 60},
				{}
			], service, IDs, callback);
		} else {
			value = characteristic.value;
			if (callback) {
				callback();
			}
		}
		setTimeout(() => {
			characteristic.setValue(value, undefined, 'fromSetValue');
		}, 100);
	}
	setHue(value, callback, context, characteristic, service, IDs) {
		let rgb = this.updateHomeCenterColorFromHomeKit(value, null, null, service);
		this.syncColorCharacteristics(rgb, service, IDs, callback);
	}
	setSaturation(value, callback, context, characteristic, service, IDs) {
		let rgb = this.updateHomeCenterColorFromHomeKit(null, value, null, service);
		this.syncColorCharacteristics(rgb, service, IDs, callback);
	}
	setSecuritySystemTargetState(value, callback, context, characteristic, service, IDs) {
		let sceneID = this.getTargetSecuritySystemSceneMapping.get(value);
		if (value == this.hapCharacteristic.SecuritySystemTargetState.DISARM)
			value = this.hapCharacteristic.SecuritySystemCurrentState.DISARMED;
		if (sceneID == undefined)
			return;
		this.scene(sceneID, callback);
	}

	updateHomeCenterColorFromHomeKit(h, s, v, service) {
		if (h != null)
			service.HSBValue.hue = h;
		if (s != null)
			service.HSBValue.saturation = s;
		if (v != null)
			service.HSBValue.brightness = v;
		var rgb = this.HSVtoRGB(service.HSBValue.hue, service.HSBValue.saturation, service.HSBValue.brightness);
		service.RGBValue.red = rgb.r;
		service.RGBValue.green = rgb.g;
		service.RGBValue.blue = rgb.b;
		service.RGBValue.white = rgb.w;
		return rgb;
	}
	HSVtoRGB(hue, saturation, value) {
		let h = hue / 360.0;
		let s = saturation / 100.0;
		let v = value / 100.0;
		let r, g, b, w, i, f, p, q, t;
		i = Math.floor(h * 6);
		f = h * 6 - i;
		p = v * (1 - s);
		q = v * (1 - f * s);
		t = v * (1 - (1 - f) * s);
		switch (i % 6) {
			case 0: r = v, g = t, b = p; break;
			case 1: r = q, g = v, b = p; break;
			case 2: r = p, g = v, b = t; break;
			case 3: r = p, g = q, b = v; break;
			case 4: r = t, g = p, b = v; break;
			case 5: r = v, g = p, b = q; break;
		}
		w = Math.min(r, g, b);
		return {
			r: Math.round(r * 255),
			g: Math.round(g * 255),
			b: Math.round(b * 255),
			w: Math.round(w * 255)
		};
	}
	syncColorCharacteristics(rgb, service, IDs, callback) {
		switch (--service.countColorCharacteristics) {
			case 1:
				service.timeoutIdColorCharacteristics = setTimeout(() => {
					if (service.countColorCharacteristics < 1)
						return;
					this.command("setR", [rgb.r], service, IDs, null);
					this.command("setG", [rgb.g], service, IDs, null);
					this.command("setB", [rgb.b], service, IDs, null);
					this.command("setW", [rgb.w], service, IDs, callback);
					service.countColorCharacteristics = 2;
					service.timeoutIdColorCharacteristics = 0;
				}, 1000);
				break;
			case 0:
				this.command("setR", [rgb.r], service, IDs, null);
				this.command("setG", [rgb.g], service, IDs, null);
				this.command("setB", [rgb.b], service, IDs, null);
				this.command("setW", [rgb.w], service, IDs, callback);
				service.countColorCharacteristics = 2;
				clearTimeout(service.timeoutIdColorCharacteristics);
				service.timeoutIdColorCharacteristics = 0;
				break;
			default:
				break;
		}
	}


	async command(c, value, service, IDs, callback) {
		try {
			await this.platform.fibaroClient.executeDeviceAction(IDs[0], c, value);
			if (callback)
				callback();
			this.platform.log("Command: ", c + ((value != undefined) ? ", value: " + value : "") + ", to: " + IDs[0]);
		} catch (e) {
			this.platform.log("There was a problem sending command ", c + " to " + IDs[0]);
		}
	}

	async scene(sceneID, callback) {
		try {
			await this.platform.fibaroClient.executeScene(sceneID);
			if (callback)
				callback();
		} catch (e) {
			this.platform.log("There was a problem executing scene: ", sceneID);
		}
	}

	async setGlobalVariable(variableID, value, callback) {
		try {
			await this.platform.fibaroClient.setGlobalVariable(variableID, value);
			if (callback)
				callback();
		} catch (e) {
			this.platform.log("There was a problem setting variable: ", `${variableID} to ${value}`);
		}
	}
	async checkLockCurrentState(IDs, value) {
		try {
			const properties = this.platform.fibaroClient.getDeviceProperties(IDs[0]);
			var currentValue = (properties.value == "true") ? this.hapCharacteristic.LockCurrentState.SECURED : this.hapCharacteristic.LockCurrentState.UNSECURED;
			if (currentValue != value) {
				this.platform.log("There was a problem setting value to Lock: ", `${IDs[0]}`);
			}
		} catch (e) {
			this.platform.log("There was a problem getting value from: ", `${IDs[0]} - Err: ${e}`);
		}
	}

	/***
	 *  Scale the value from input range to output range as integer
	 * @param num value to be scaled
	 * @param in_min input value range minimum
	 * @param in_max input value range maximum
	 * @param out_min output value range minimum
	 * @param out_max output value range maximum
	 */
	static scale(num: number, in_min: number, in_max: number, out_min: number, out_max: number): number {
		return Math.trunc((num - in_min) * (out_max - out_min) / (in_max - in_min) + out_min);
	}
}

