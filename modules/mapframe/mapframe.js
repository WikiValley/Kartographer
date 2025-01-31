/**
 * Frame module.
 *
 * Once the page is loaded and ready, turn all `<mapframe/>` tags into
 * interactive maps.
 *
 * @alternateClassName Frame
 * @alternateClassName ext.kartographer.frame
 * @class Kartographer.Frame
 * @singleton
 */
var util = require( 'ext.kartographer.util' ),
	kartobox = require( 'ext.kartographer.box' ),
	router = require( 'mediawiki.router' ),
	rAF = window.requestAnimationFrame || setTimeout,

	/**
	 * References the mapframe containers of the page.
	 *
	 * @type {HTMLElement[]}
	 */
	maps = [],
	/**
	 * @private
	 * @ignore
	 */
	routerInited = false;

/**
 * Gets the map data attached to an element.
 *
 * @param {HTMLElement} element Element
 * @return {Object} Map properties
 * @return {number} return.latitude
 * @return {number} return.longitude
 * @return {number} return.zoom
 * @return {string} return.lang Language code
 * @return {string} return.style Map style
 * @return {string[]} return.overlays Overlay groups
 * @return {string} return.captionText
 */
function getMapData( element ) {
	var $el = $( element ),
		$caption = $el.parent().find( '.thumbcaption' ),
		captionText = '';

	if ( $caption[ 0 ] ) {
		captionText = $caption.get( 0 ).innerText;
	}

	return {
		latitude: +$el.data( 'lat' ),
		longitude: +$el.data( 'lon' ),
		zoom: +$el.data( 'zoom' ),
		lang: $el.data( 'lang' ) || util.getDefaultLanguage(),
		style: $el.data( 'style' ),
		overlays: $el.data( 'overlays' ) || [],
		captionText: captionText
	};
}

/**
 * @param {Object} data
 * @param {jQuery} $container
 * @return {Object} map KartographerMap
 */
function initMapBox( data, $container ) {
	var index = maps.length;

	data.enableFullScreenButton = true;

	var map = kartobox.map( {
		featureType: 'mapframe',
		container: $container.get( 0 ),
		center: [ data.latitude, data.longitude ],
		zoom: data.zoom,
		lang: data.lang,
		fullScreenRoute: '/map/' + index,
		allowFullScreen: true,
		dataGroups: data.overlays,
		captionText: data.captionText,
		alwaysStatic: mw.config.get( 'wgKartographerStaticMapframePreview' )
	} );

	$container.removeAttr( 'href' );
	$container.find( 'img' ).remove();

	maps[ index ] = map;

	// Special case for collapsed maps.
	// When the container is initially hidden Leaflet is not able to
	// calculate the expected size when visible. We need to force
	// updating the map to the new container size on `expand`.
	// eslint-disable-next-line no-jquery/no-sizzle
	if ( !$container.is( ':visible' ) ) {
		$container.closest( '.mw-collapsible' )
			.on( 'afterExpand.mw-collapsible', map.invalidateSizeAndSetInitialView.bind( map ) );

		// If MobileFrontend is active do the same for collapsible sections
		// Unfortunately doesn't work when those sections are immediately
		// made visible again on page load.
		mw.loader.using( 'mobile.startup', function () {
			// this will not complete when target != desktop
			mw.mobileFrontend.require( 'mobile.startup' ).eventBusSingleton
				.on( 'section-toggled', map.invalidateSizeAndSetInitialView.bind( map ) );
		} );
	}

	return map;
}

/**
 * Create a mapbox from a given element.
 *
 * @param {HTMLElement} element Parsed <mapframe> element
 */
function initMapframeFromElement( element ) {
	var map = initMapBox( getMapData( element ), $( element ) );
	mw.hook( 'wikipage.maps' ).fire( [ map ], false /* isFullScreen */ );
}

/**
 * This code will be executed once the article is rendered and ready.
 *
 * @ignore
 */
mw.hook( 'wikipage.content' ).add( function ( $content ) {
	// `wikipage.content` may be fired more than once.
	while ( maps.length ) {
		maps.pop().remove();
	}

	// Wait for next draw cycle, so that the JS map is not initialized before it is on screen.
	// If initialized too early leaflet uses incorrect dimensions. phab:T151524
	// https://github.com/Leaflet/Leaflet/issues/4200
	rAF( function () {
		$content.find( '.mw-kartographer-map[data-mw="interface"]' ).each( function () {
			initMapBox( getMapData( this ), $( this ) );
		} );

		// Allow customizations of interactive maps in article.
		mw.hook( 'wikipage.maps' ).fire( maps, false /* isFullScreen */ );

		if ( routerInited ) {
			return;
		}
		// execute this piece of code only once
		routerInited = true;

		// Opens a map in full screen. #/map(/:zoom)(/:latitude)(/:longitude)
		// Examples:
		//     #/map/0
		//     #/map/0/5
		//     #/map/0/16/-122.4006/37.7873
		router.route( /map\/([0-9]+)(?:\/([0-9]+))?(?:\/([+-]?\d+\.?\d{0,5})?\/([+-]?\d+\.?\d{0,5})?)?/, function ( maptagId, zoom, latitude, longitude ) {
			var map = maps[ maptagId ],
				position;

			if ( !map ) {
				router.navigate( '' );
				return;
			}

			if ( zoom !== undefined && latitude !== undefined && longitude !== undefined ) {
				position = {
					center: [ +latitude, +longitude ],
					zoom: +zoom
				};
			} else {
				position = map.getInitialMapPosition();
			}

			map.openFullScreen( position );
		} );

		// Check if we need to open a map in full screen.
		router.checkRoute();
	} );
} );

module.exports = {
	initMapframeFromElement: initMapframeFromElement
};
