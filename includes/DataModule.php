<?php
/**
 * ResourceLoader module providing extra data to the client-side.
 *
 * @file
 * @ingroup Extensions
 */

namespace Kartographer;

use ExtensionRegistry;
// phpcs:disable MediaWiki.Classes.FullQualifiedClassName -- T308814
use MediaWiki\ResourceLoader as RL;
use MediaWiki\ResourceLoader\ResourceLoader;

/**
 * @license MIT
 */
class DataModule extends RL\Module {

	/** @inheritDoc */
	protected $targets = [ 'desktop', 'mobile' ];

	/**
	 * @inheritDoc
	 */
	public function getScript( RL\Context $context ) {
		$config = $this->getConfig();
		return ResourceLoader::makeConfigSetScript( [
			'wgKartographerMapServer' => $config->get( 'KartographerMapServer' ),
			'wgKartographerSrcsetScales' => $config->get( 'KartographerSrcsetScales' ),
			'wgKartographerStyles' => $config->get( 'KartographerStyles' ),
			'wgKartographerDfltStyle' => $config->get( 'KartographerDfltStyle' ),
			'wgKartographerUsePageLanguage' => $config->get( 'KartographerUsePageLanguage' ),
			'wgKartographerFallbackZoom' => $config->get( 'KartographerFallbackZoom' ),
			'wgKartographerSimpleStyleMarkers' => $config->get( 'KartographerSimpleStyleMarkers' ),
			'wgKartographerNearby' => $this->canUseNearby(),
			'wgKartographerNearbyClustering' => $config->get( 'KartographerNearbyClustering' ),
			'wgKartographerNearbyOnMobile' => $config->get( 'KartographerNearbyOnMobile' ),
			'wgKartographerWikivoyageNearby' => $config->get( 'KartographerWikivoyageNearby' ),
		] );
	}

	/**
	 * @inheritDoc
	 */
	public function enableModuleContentVersion() {
		return true;
	}

	/**
	 * @see RL\Module::supportsURLLoading
	 *
	 * @return bool
	 */
	public function supportsURLLoading() {
		// always use getScript() to acquire JavaScript (even in debug mode)
		return false;
	}

	/**
	 * @return bool
	 */
	private function canUseNearby() {
		if ( !$this->getConfig()->get( 'KartographerNearby' ) ) {
			return false;
		}

		if ( !ExtensionRegistry::getInstance()->isLoaded( 'GeoData' ) ||
			!ExtensionRegistry::getInstance()->isLoaded( 'CirrusSearch' )
		) {
			throw new \ConfigException( '$wgKartographerNearby requires GeoData and CirrusSearch extensions' );
		}

		return true;
	}

}
