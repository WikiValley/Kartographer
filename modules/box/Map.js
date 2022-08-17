/**
 * # Kartographer Map class.
 *
 * Creates a map with layers, markers, and interactivity.
 *
 * Avoid creating a local variable "Map" as this is a native function in ES6.
 *
 * @alternateClassName KartographerMap
 * @class Kartographer.Box.MapClass
 * @extends L.Map
 */
var util = require( 'ext.kartographer.util' ),
	OpenFullScreenControl = require( './openfullscreen_control.js' ),
	dataLayerOpts = require( './dataLayerOpts.js' ),
	ScaleControl = require( './scale_control.js' ),
	DataManagerFactory = require( './data.js' ),
	Nearby = require( './nearby.js' ),
	scale, urlFormat,
	worldLatLng = new L.LatLngBounds( [ -90, -180 ], [ 90, 180 ] ),
	KartographerMap,
	precisionPerZoom = [ 0, 0, 1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5 ],
	inlineDataLayerKey = 'kartographer-inline-data-layer',
	inlineDataLayerId = 0;

function bracketDevicePixelRatio() {
	var i, scl,
		brackets = mw.config.get( 'wgKartographerSrcsetScales' ),
		baseRatio = window.devicePixelRatio || 1;
	if ( !brackets ) {
		return 1;
	}
	brackets.unshift( 1 );
	for ( i = 0; i < brackets.length; i++ ) {
		scl = brackets[ i ];
		if ( scl >= baseRatio || ( baseRatio - scl ) < 0.1 ) {
			return scl;
		}
	}
	return brackets[ brackets.length - 1 ];
}

scale = bracketDevicePixelRatio();
scale = ( scale === 1 ) ? '' : ( '@' + scale + 'x' );
urlFormat = '/{z}/{x}/{y}' + scale + '.png';

require( './leaflet.sleep.js' );
require( './mapbox-settings.js' ).configure();
require( './enablePreview.js' );

L.Map.mergeOptions( {
	sleepTime: 250,
	wakeTime: 500,
	sleepNote: false,
	sleepOpacity: 1,
	// the default zoom applied when `longitude` and `latitude` were
	// specified, but zoom was not.
	fallbackZoom: mw.config.get( 'wgKartographerFallbackZoom' )
} );

L.Popup.mergeOptions( {
	minWidth: 160,
	maxWidth: 300,
	autoPanPadding: [ 12, 12 ]
} );

/* eslint-disable no-underscore-dangle */
/**
 * Validate that the bounds contain no outlier.
 *
 * An outlier is a layer whom bounds do not fit into the world,
 * i.e. `-180 <= longitude <= 180  &&  -90 <= latitude <= 90`
 *
 * There is a special case for **masks** (polygons that cover the entire
 * globe with a hole to highlight a specific area). In this case the
 * algorithm tries to validate the hole bounds.
 *
 * @param {L.Layer} layer Layer to get and validate the bounds.
 * @return {L.LatLng|boolean} Bounds if valid.
 * @private
 */
function validateBounds( layer ) {
	var bounds = ( typeof layer.getBounds === 'function' ) && layer.getBounds();

	bounds = bounds || ( typeof layer.getLatLng === 'function' ) && layer.getLatLng();

	if ( bounds && worldLatLng.contains( bounds ) ) {
		return bounds;
	} else if ( layer instanceof L.Polygon && layer.getLatLngs() && layer.getLatLngs()[ 1 ] ) {
		// This is a geomask
		// We drop the outer ring (aka world) and only look at the layers that are holes
		bounds = new L.LatLngBounds( layer._convertLatLngs( layer.getLatLngs().slice( 1 ) ) );
		if ( worldLatLng.contains( bounds ) ) {
			return bounds;
		}
	}
	return false;
}

/**
 * Gets the valid bounds of a map/layer.
 *
 * @param {L.Map|L.Layer} layer
 * @return {L.LatLngBounds} Extended bounds
 * @private
 */
function getValidBounds( layer ) {
	var layerBounds = new L.LatLngBounds();
	if ( typeof layer.eachLayer === 'function' ) {
		layer.eachLayer( function ( child ) {
			layerBounds.extend( getValidBounds( child ) );
		} );
	} else {
		layerBounds.extend( validateBounds( layer ) );
	}
	return layerBounds;
}

KartographerMap = L.Map.extend( {
	/**
	 * Create a map within options.container
	 *
	 * options.container has to be visible before constructing the map
	 * or call invalidateSizeAndSetInitialView when it becomes visible.
	 * See also phab:T151524 and https://github.com/Leaflet/Leaflet/issues/4200
	 *
	 * @constructor
	 * @param {Object} options **Configuration and options:**
	 * @param {HTMLElement} options.container **Map container.**
	 * @param {boolean} [options.allowFullScreen=false] **Whether the map
	 *   can be opened in a full screen dialog.**
	 * @param {string[]} [options.dataGroups] **List of known data groups,
	 *   fetchable from the server, to add as overlays onto the map.**
	 * @param {Object|Array} [options.data] **Inline GeoJSON features to
	 *   add to the map.**
	 * @param {boolean} [options.alwaysInteractive=false] Prevents the map
	 *   from becoming static when the screen is too small.
	 * @param {Array|L.LatLng|string} [options.center] **Initial map center.**
	 * @param {number|string} [options.zoom] **Initial map zoom.**
	 * @param {string} [options.lang] Language for map labels
	 * @param {string} [options.style] Map style. _Defaults to
	 *  `mw.config.get( 'wgKartographerDfltStyle' )`._
	 * @param {Kartographer.Box.MapClass} [options.parentMap] Parent map
	 *   _(internal, used by the full screen map to refer its parent map)_.
	 * @param {boolean} [options.fullscreen=false] Whether the map is a map
	 *   opened in a full screen dialog _(internal, used to indicate it is
	 *   a full screen map)_.
	 * @param {string} [options.fullScreenRoute] Route associated to this map
	 *   _(internal, used by "`<maplink>`" and "`<mapframe>`")_.
	 * @member Kartographer.Box.MapClass
	 */
	initialize: function ( options ) {
		var args,
			mapServer = mw.config.get( 'wgKartographerMapServer' ),
			defaultStyle = mw.config.get( 'wgKartographerDfltStyle' ),
			style = options.style || defaultStyle,
			map = this;

		if ( !mapServer ) {
			throw new Error( 'wgKartographerMapServer must be configured.' );
		}

		if ( options.center === 'auto' ) {
			options.center = undefined;
		}
		if ( options.zoom === 'auto' ) {
			options.zoom = undefined;
		}

		$( options.container ).addClass( 'mw-kartographer-interactive' );

		args = L.extend( {}, L.Map.prototype.options, options, {
			// `center` and `zoom` are to undefined to avoid calling
			// setView now. setView is called later when the data is
			// loaded.
			center: undefined,
			zoom: undefined
		} );

		L.Map.prototype.initialize.call( this, options.container, args );

		/**
		 * @property {jQuery} $container Reference to the map
		 *   container.
		 * @protected
		 */
		this.$container = $( this._container );

		this.on( 'kartographerisready', function () {
			// eslint-disable-next-line camelcase
			map._kartographer_ready = true;
		} );

		/**
		 * @property {Kartographer.Box.MapClass} [parentMap=null] Reference
		 *   to the parent map.
		 * @protected
		 */
		this.parentMap = options.parentMap || null;

		/**
		 * @property {Kartographer.Box.MapClass} [parentLink=null] Reference
		 *   to the parent link.
		 * @protected
		 */
		this.parentLink = options.parentLink || null;

		/**
		 * @property {string} The feature type identifier.
		 * @protected
		 */
		this.featureType = options.featureType;

		/**
		 * @property {Kartographer.Box.MapClass} [fullScreenMap=null] Reference
		 *   to the child full screen map.
		 * @protected
		 */
		this.fullScreenMap = null;

		/**
		 * @property {boolean} useRouter Whether the map uses the Mediawiki Router.
		 * @protected
		 */
		this.useRouter = !!options.fullScreenRoute;

		/**
		 * @property {string} [fullScreenRoute=null] Route associated to this map.
		 * @protected
		 */
		this.fullScreenRoute = options.fullScreenRoute || null;

		/**
		 * @property {string} [captionText=''] Caption associated to the map.
		 * @protected
		 */
		this.captionText = options.captionText || '';

		/**
		 * @property {string} lang Language code to use for labels
		 * @type {string}
		 */
		this.lang = options.lang || util.getDefaultLanguage();

		/**
		 * @property {Object} dataLayers References to the data layers.
		 * @protected
		 */
		this.dataLayers = {};

		/* Add base layer */

		/**
		 * @property {string} layerUrl Base URL for the tile layer
		 * @protected
		 */
		this.layerUrl = mapServer + ( style ? '/' + style : '' ) + urlFormat;

		/**
		 * @property {L.TileLayer} wikimediaLayer Reference to `Wikimedia`
		 *   tile layer.
		 * @protected
		 */
		this.wikimediaLayer = L.tileLayer(
			this.getLayerUrl(),
			{
				maxZoom: 19,
				attribution: mw.message( 'kartographer-attribution' ).parse()
			}
		).addTo( this );

		/* Add map controls */

		/**
		 * @property {L.Control.Attribution} attributionControl Reference
		 *   to attribution control.
		 */
		this.attributionControl.setPrefix( '' );

		/**
		 * @property {Kartographer.Box.ScaleControl} scaleControl Reference
		 *   to scale control.
		 */
		this.scaleControl = new ScaleControl( { position: 'bottomright' } ).addTo( this );

		if ( options.allowFullScreen ) {
			// embed maps, and full screen is allowed
			this.on( 'dblclick', function () {
				map.openFullScreen();
			} );

			/**
			 * @property {Kartographer.Box.OpenFullScreenControl|undefined} [openFullScreenControl=undefined]
			 * Reference to open full screen control.
			 */
			this.openFullScreenControl = new OpenFullScreenControl( { position: 'topright' } ).addTo( this );
		}

		/* Initialize map */

		if ( !this._container.clientWidth || !this._container.clientHeight ) {
			this._fixMapSize();
		}
		if ( !this.options.fullscreen ) {
			this.doubleClickZoom.disable();
		}

		if ( !this.options.fullscreen && !options.alwaysInteractive ) {
			this._invalidateInteractive();
		}

		// The `ready` function has not fired yet so there is no center or zoom defined.
		// Disable panning and zooming until that has happened.
		// See T257872.
		map.dragging.disable();
		map.touchZoom.disable();

		function ready() {
			map.initView( options.center, options.zoom );
			map.dragging.enable();
			map.touchZoom.enable();
			map.fire(
				/**
				 * @event kartographerisready
				 * Fired when the Kartographer Map object is ready.
				 */
				'kartographerisready' );
		}

		if ( this.parentMap ) {
			// eslint-disable-next-line no-jquery/no-each-util
			$.each( this.parentMap.dataLayers, function ( groupId, layer ) {
				map.addGeoJSONLayer( groupId, layer.getGeoJSON(), layer.options );
			} );
			ready();
			return;
		}

		this.addDataGroups( options.dataGroups ).then( function () {
			if ( typeof options.data === 'object' ) {
				map.addDataLayer( options.data ).then( function () {
					ready();
				} );
			} else {
				ready();
			}
		}, function () {
			// T25787
			ready();
			mw.log.error( 'Unable to add datalayers to map.' );
		} );
	},

	/**
	 * Runs the given callback **when the Kartographer map has finished
	 * loading the data layers and positioning** the map with a center and
	 * zoom, **or immediately if it happened already**.
	 *
	 * @param {Function} callback
	 * @param {Object} [context]
	 * @chainable
	 */
	doWhenReady: function ( callback, context ) {
		if ( this._kartographer_ready ) {
			callback.call( context || this, this );
		} else {
			this.on( 'kartographerisready', callback, context );
		}
		return this;
	},

	/**
	 * Sets the initial center and zoom of the map, and optionally calls
	 * {@link #setView} to reposition the map.
	 *
	 * @param {L.LatLng|number[]} [center]
	 * @param {number} [zoom]
	 * @param {boolean} [setView=true]
	 * @chainable
	 */
	initView: function ( center, zoom, setView ) {
		if ( Array.isArray( center ) ) {
			if ( !isNaN( center[ 0 ] ) && !isNaN( center[ 1 ] ) ) {
				center = L.latLng( center );
			} else {
				center = undefined;
			}
		}

		zoom = isNaN( zoom ) ? undefined : zoom;
		this._initialPosition = {
			center: center,
			zoom: zoom
		};
		if ( setView !== false ) {
			this.setView( center, zoom, null, true );
		}
		return this;
	},

	/**
	 * Gets and adds known data groups as layers onto the map.
	 *
	 * The data is loaded from the server if not found in memory.
	 *
	 * @param {string[]} dataGroups
	 * @return {jQuery.Promise}
	 */
	addDataGroups: function ( dataGroups ) {
		var map = this;

		if ( !dataGroups || !dataGroups.length ) {
			return $.Deferred().resolve().promise();
		}

		return DataManagerFactory().loadGroups( dataGroups ).then( function ( groups ) {
			// eslint-disable-next-line no-jquery/no-each-util
			$.each( groups, function ( key, group ) {
				var layerOptions = {
					attribution: group.attribution
				};
				if ( group.isExternal ) {
					layerOptions.name = group.attribution;
				}
				if ( !$.isEmptyObject( group.getGeoJSON() ) ) {
					map.addGeoJSONLayer( group.id, group.getGeoJSON(), layerOptions );
				} else {
					mw.log.warn( 'Layer not found or contains no data: "' + group.id + '"' );
				}
			} );
		} );
	},

	/**
	 * Creates a new GeoJSON layer and adds it to the map.
	 *
	 * @param {Object} groupData Features
	 * @param {Object} [options] Layer options
	 * @return {jQuery.Promise} Promise which resolves when the layer has been added
	 */
	addDataLayer: function ( groupData, options ) {
		var map = this;
		options = options || {};

		return DataManagerFactory().load( groupData ).then( function ( dataGroups ) {
			// eslint-disable-next-line no-jquery/no-each-util
			$.each( dataGroups, function ( key, group ) {
				var groupId = inlineDataLayerKey + inlineDataLayerId++,
					layerOptions = {
						attribution: group.attribution || options.attribution
					};
				if ( group.isExternal ) {
					layerOptions.name = group.attribution;
				}
				if ( !$.isEmptyObject( group.getGeoJSON() ) ) {
					map.addGeoJSONLayer( groupId, group.getGeoJSON(), layerOptions );
				} else {
					mw.log.warn( 'Layer not found or contains no data: "' + groupId + '"' );
				}
			} );
		} );
	},

	/**
	 * Creates a new GeoJSON layer and adds it to the map.
	 *
	 * @param {string} groupId
	 * @param {Object} geoJson Features
	 * @param {Object} [options] Layer options
	 * @return {L.mapbox.FeatureLayer|undefined} Added layer, or undefined in case e.g. the GeoJSON
	 *   was invalid
	 */
	addGeoJSONLayer: function ( groupId, geoJson, options ) {
		var layer;
		try {
			layer = L.mapbox.featureLayer( geoJson, $.extend( {}, dataLayerOpts, options ) ).addTo( this );
			layer.getAttribution = function () {
				return this.options.attribution;
			};
			this.attributionControl.addAttribution( layer.getAttribution() );
			this.dataLayers[ groupId ] = layer;
			layer.dataGroup = groupId;
			return layer;
		} catch ( e ) {
			mw.log( e );
		}
	},

	/**
	 * Opens the map in a full screen dialog.
	 *
	 * **Uses Resource Loader module: {@link Kartographer.Dialog ext.kartographer.dialog}**
	 *
	 * @param {Object} [position] Map `center` and `zoom`.
	 */
	openFullScreen: function ( position ) {
		this.doWhenReady( function () {

			var map = this.options.link ? this : this.fullScreenMap;
			position = position || this.getMapPosition();

			if ( !map ) {
				map = this.fullScreenMap = new KartographerMap( {
					container: L.DomUtil.create( 'div', 'mw-kartographer-mapDialog-map' ),
					center: position.center,
					zoom: position.zoom,
					lang: this.lang,
					featureType: this.featureType,
					fullscreen: true,
					captionText: this.captionText,
					fullScreenRoute: this.fullScreenRoute,
					parentMap: this
				} );
				// resets the right initial position silently afterwards.
				map.initView(
					this._initialPosition.center,
					this._initialPosition.zoom,
					false
				);
			} else if ( map._updatingHash ) {
				// Skip - there is nothing to do.
				delete map._updatingHash;
				return;
			} else {
				this.doWhenReady( function () {
					map.setView(
						position.center,
						position.zoom
					);
				} );
			}

			mw.loader.using( 'ext.kartographer.dialog' ).then( function () {
				map.doWhenReady( function () {
					require( 'ext.kartographer.dialog' ).render( map );
				} );
			} );
		}, this );
	},

	/**
	 * Closes full screen dialog.
	 *
	 * @chainable
	 */
	closeFullScreen: function () {
		require( 'ext.kartographer.dialog' ).close();
		return this;
	},

	/**
	 * Gets initial map center and zoom.
	 *
	 * @return {Object}
	 * @return {L.LatLng} return.center
	 * @return {number} return.zoom
	 */
	getInitialMapPosition: function () {
		return this._initialPosition;
	},

	/**
	 * Gets current map center and zoom.
	 *
	 * @param {Object} [options]
	 * @param {boolean} [options.scaled=false] Whether you want the
	 *   coordinates to be scaled to the current zoom.
	 * @return {Object}
	 * @return {L.LatLng} return.center
	 * @return {number} return.zoom
	 */
	getMapPosition: function ( options ) {
		var center = this.getCenter().wrap(),
			zoom = this.getZoom();

		if ( options && options.scaled ) {
			center = L.latLng( this.getScaleLatLng( center.lat, center.lng, zoom ) );
		}
		return {
			center: center,
			zoom: zoom
		};
	},

	/**
	 * Formats the full screen route of the map, such as:
	 *   `/map/:maptagId(/:zoom/:longitude/:latitude)`
	 *
	 * The hash will contain the portion between parenthesis if and only if
	 * one of these 3 values differs from the initial setting.
	 *
	 * @return {string} The route to open the map in full screen mode.
	 */
	getHash: function () {
		if ( !this._initialPosition ) {
			return this.fullScreenRoute;
		}

		var hash = this.fullScreenRoute,
			currentPosition = this.getMapPosition(),
			initialPosition = this._initialPosition,
			newHash = currentPosition.zoom + '/' + this.getScaleLatLng(
				currentPosition.center.lat,
				currentPosition.center.lng,
				currentPosition.zoom
			).join( '/' ),
			initialHash = initialPosition.center && (
				initialPosition.zoom + '/' +
				this.getScaleLatLng(
					initialPosition.center.lat,
					initialPosition.center.lng,
					initialPosition.zoom
				).join( '/' )
			);

		if ( newHash !== initialHash ) {
			hash += '/' + newHash;
		}

		return hash;
	},

	/**
	 * Sets the map at a certain zoom and position.
	 *
	 * When the zoom and map center are provided, it falls back to the
	 * original `L.Map#setView`.
	 *
	 * If the zoom or map center are not provided, this method will
	 * calculate some values so that all the point of interests fit within the
	 * map.
	 *
	 * **Note:** Unlike the original `L.Map#setView`, it accepts an optional
	 * fourth parameter to decide whether to update the container's data
	 * attribute with the calculated values (for performance).
	 *
	 * @param {L.LatLng|number[]|string} [center] Map center.
	 * @param {number} [zoom]
	 * @param {Object} [options] See [L.Map#setView](https://www.mapbox.com/mapbox.js/api/v2.3.0/l-map-class/)
	 *   documentation for the full list of options.
	 * @param {boolean} [save=false] Whether to update the data attributes.
	 * @chainable
	 */
	setView: function ( center, zoom, options, save ) {
		var maxBounds,
			initial = this.getInitialMapPosition();

		if ( Array.isArray( center ) ) {
			if ( !isNaN( center[ 0 ] ) && !isNaN( center[ 1 ] ) ) {
				center = L.latLng( center );
			} else {
				center = undefined;
			}
		}
		if ( center ) {
			zoom = isNaN( zoom ) ? this.options.fallbackZoom : zoom;
			L.Map.prototype.setView.call( this, center, zoom, options );
		} else {
			// Determines best center of the map
			// Bounds calulation depends on the size of the frame
			// If the frame is not visible, there is no point in calculating
			// You need to call invalidateSize when it becomes available again
			maxBounds = getValidBounds( this );

			if ( maxBounds.isValid() ) {
				this.fitBounds( maxBounds );
			} else {
				this.fitWorld();
			}
			// (Re-)Applies expected zoom

			if ( initial && !isNaN( initial.zoom ) ) {
				this.setZoom( initial.zoom );
			}

			// Save the calculated position,
			// unless we already know it is incorrect due to being loaded
			// when the frame was invisble and had no dimensions to base
			// autozoom, autocenter on.
			// eslint-disable-next-line no-jquery/no-sizzle
			if ( this.$container.is( ':visible' ) && save ) {
				// Updates map data.
				this.initView( this.getCenter(), this.getZoom(), false );
				// Updates container's data attributes to avoid `NaN` errors
				if ( !this.fullscreen ) {
					this.$container.closest( '.mw-kartographer-interactive' ).data( {
						zoom: this.getZoom(),
						longitude: this.getCenter().lng,
						latitude: this.getCenter().lat
					} );
				}
			}
		}
		return this;
	},

	/**
	 * @param {boolean} show
	 */
	showNearby: function ( show ) {
		if ( show && !this.nearbyLayer ) {
			var map = this;
			// TODO: Replace or merge nearby points when moving the viewport.
			Nearby.fetch( this.getBounds(), this.getZoom() ).then( function ( data ) {
				map.nearbyLayer = Nearby.createNearbyLayer(
					Nearby.convertGeosearchToGeojson( data )
				);
				map.addLayer( map.nearbyLayer );
			} );
		} else if ( !show && this.nearbyLayer ) {
			this.removeLayer( this.nearbyLayer );
			// Allows the user to workaround the lack of scrolling.
			// TODO: Don't throw away the data.
			this.nearbyLayer = null;
		}
	},

	/**
	 * Get the URL to be passed to L.TileLayer
	 *
	 * @private
	 * @return {string}
	 */
	getLayerUrl: function () {
		return this.layerUrl + '?' + $.param( { lang: this.lang } );
	},

	/**
	 * Change the map's language.
	 *
	 * This will cause the map to be rerendered if the language is different.
	 *
	 * @param {string} lang New language code
	 */
	setLang: function ( lang ) {
		if ( this.lang !== lang ) {
			this.lang = lang;
			this.wikimediaLayer.setUrl( this.getLayerUrl() );
		}
	},

	/**
	 * Convenient method that formats the coordinates based on the zoom level.
	 *
	 * @param {number} lat
	 * @param {number} lng
	 * @param {number} [zoom]
	 * @return {Array} Array with the zoom (number), the latitude (string) and
	 *   the longitude (string).
	 */
	getScaleLatLng: function ( lat, lng, zoom ) {
		zoom = typeof zoom === 'undefined' ? this.getZoom() : zoom;

		return [
			lat.toFixed( precisionPerZoom[ zoom ] ),
			lng.toFixed( precisionPerZoom[ zoom ] )
		];
	},

	/**
	 * @localdoc Extended to also destroy the {@link #fullScreenMap} when
	 *   it exists.
	 *
	 * @override
	 * @chainable
	 */
	remove: function () {
		var parent = this.parentMap || this.parentLink;

		if ( this.fullScreenMap ) {
			L.Map.prototype.remove.call( this.fullScreenMap );
			this.fullScreenMap = null;
		}
		if ( parent ) {
			parent.fullScreenMap = null;
		}

		return L.Map.prototype.remove.call( this );
	},

	/**
	 * Fixes map size when the container is not visible yet, thus has no
	 * physical size.
	 *
	 * - In full screen, we take the viewport width and height.
	 * - Otherwise, the hack is to try jQuery which will pick up CSS
	 *   dimensions. (T125263)
	 * - Finally, if the calculated size is still [0,0], the script looks
	 *   for the first visible parent and takes its `height` and `width`
	 *   to initialize the map.
	 *
	 * @protected
	 */
	_fixMapSize: function () {
		var width, height, $visibleParent;

		if ( this.options.fullscreen ) {
			this._size = new L.Point(
				window.innerWidth,
				window.innerHeight
			);
			this._sizeChanged = false;
			return;
		}

		// eslint-disable-next-line no-jquery/no-sizzle
		$visibleParent = this.$container.closest( ':visible' );

		// Try `max` properties.
		width = $visibleParent.css( 'max-width' );
		height = $visibleParent.css( 'max-height' );
		width = ( !width || width === 'none' ) ? $visibleParent.width() : width;
		height = ( !height || height === 'none' ) ? $visibleParent.height() : height;

		while ( ( !height && $visibleParent.parent().length ) ) {
			$visibleParent = $visibleParent.parent();
			width = $visibleParent.outerWidth( true );
			height = $visibleParent.outerHeight( true );
		}

		this._size = new L.Point( width, height );
	},

	/**
	 * Adds Leaflet.Sleep handler and overrides `invalidateSize` when the map
	 * is not in full screen mode.
	 *
	 * The new `invalidateSize` method calls {@link #toggleStaticState} to
	 * determine the new state and make the map either static or interactive.
	 *
	 * @chainable
	 * @protected
	 */
	_invalidateInteractive: function () {
		// add Leaflet.Sleep when the map isn't full screen.
		this.addHandler( 'sleep', L.Map.Sleep );

		// `invalidateSize` is triggered on window `resize` events.
		this.invalidateSize = function ( options ) {
			L.Map.prototype.invalidateSize.call( this, options );

			if ( this.options.fullscreen ) {
				// skip if the map is full screen
				return this;
			}
			// Local debounce because OOjs is not yet available.
			if ( this._staticTimer ) {
				clearTimeout( this._staticTimer );
			}
			this._staticTimer = setTimeout( this.toggleStaticState, 200 );
			return this;
		};
		// Initialize static state.
		this.toggleStaticState = L.Util.bind( this.toggleStaticState, this );
		this.toggleStaticState();
		return this;
	},

	/**
	 * Makes the map interactive IIF :
	 *
	 * - the `device width > 480px`,
	 * - there is at least a 200px horizontal margin.
	 *
	 * Otherwise makes it static.
	 *
	 * @chainable
	 */
	toggleStaticState: function () {
		var deviceWidth = window.innerWidth,
			// All maps static if deviceWitdh < 480px
			isSmallWindow = deviceWidth <= 480,
			staticMap;

		// If the window is wide enough, make sure there is at least
		// a 200px margin to scroll, otherwise make the map static.
		staticMap = isSmallWindow || ( this.getSize().x + 200 ) > deviceWidth;

		// Skip if the map is already static
		if ( this._static === staticMap ) {
			return;
		}

		// Toggle static/interactive state of the map
		this._static = staticMap;

		if ( staticMap ) {
			this.sleep._sleepMap();
			this.sleep.disable();
			this.scrollWheelZoom.disable();
		} else {
			this.sleep.enable();
		}
		this.$container.toggleClass( 'mw-kartographer-static', staticMap );
		return this;
	},

	/**
	 * Reinitialize a view that was originally hidden.
	 *
	 * These views will have calculated autozoom and autoposition of shapes incorrectly
	 * because the size of the map frame will initially be 0.
	 *
	 * We need to fetch the original position information, invalidate to make sure the
	 * frame is readjusted and then reset the view, so that it will recalculate the
	 * autozoom and autoposition if needed.
	 *
	 * @override
	 * @chainable
	 */
	invalidateSizeAndSetInitialView: function () {
		var position = this.getInitialMapPosition();
		this.invalidateSize();
		if ( position ) {
			// at rare times during load fases, position might be undefined
			this.initView( position.center, position.zoom, true );
		}

		return this;
	}
} );

module.exports = {
	Map: KartographerMap,
	map: function ( options ) {
		return new KartographerMap( options );
	}
};
