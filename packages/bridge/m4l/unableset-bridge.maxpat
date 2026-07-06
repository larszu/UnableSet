{
	"patcher": {
		"fileversion": 1,
		"appversion": { "major": 8, "minor": 5, "revision": 0, "architecture": "x64", "modernui": 1 },
		"classnamespace": "box",
		"rect": [ 100.0, 100.0, 640.0, 400.0 ],
		"bglocked": 0,
		"openinpresentation": 1,
		"boxes": [
			{
				"box": {
					"id": "obj-1",
					"maxclass": "newobj",
					"numinlets": 0,
					"numoutlets": 1,
					"outlettype": [ "" ],
					"patching_rect": [ 40.0, 60.0, 120.0, 22.0 ],
					"text": "udpreceive 11010"
				}
			},
			{
				"box": {
					"id": "obj-2",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [ "" ],
					"patching_rect": [ 40.0, 120.0, 160.0, 22.0 ],
					"saved_object_attributes": { "filename": "unableset-bridge.js", "parameter_enable": 0 },
					"text": "js unableset-bridge.js"
				}
			},
			{
				"box": {
					"id": "obj-3",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [ 40.0, 180.0, 170.0, 22.0 ],
					"text": "udpsend 127.0.0.1 11011"
				}
			},
			{
				"box": {
					"id": "obj-4",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [ "bang" ],
					"patching_rect": [ 220.0, 60.0, 80.0, 22.0 ],
					"text": "loadbang"
				}
			},
			{
				"box": {
					"id": "obj-5",
					"maxclass": "comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [ 240.0, 120.0, 360.0, 20.0 ],
					"presentation": 1,
					"presentation_rect": [ 10.0, 10.0, 360.0, 20.0 ],
					"text": "UnableSet Bridge (Weg B) — Host: --osc-port 11010 --osc-listen-port 11011"
				}
			}
		],
		"lines": [
			{ "patchline": { "destination": [ "obj-2", 0 ], "source": [ "obj-1", 0 ] } },
			{ "patchline": { "destination": [ "obj-3", 0 ], "source": [ "obj-2", 0 ] } },
			{ "patchline": { "destination": [ "obj-2", 0 ], "source": [ "obj-4", 0 ] } }
		],
		"dependency_cache": [
			{ "name": "unableset-bridge.js", "bootpath": ".", "type": "TEXT", "implicit": 1 }
		],
		"autosave": 0
	}
}
