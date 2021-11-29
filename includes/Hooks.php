<?php
/**
 *
 * @license MIT
 * @file
 *
 * @author Yuri Astrakhan
 */

namespace Kartographer;

use Kartographer\Tag\MapFrame;
use Kartographer\Tag\MapLink;
use Kartographer\Tag\TagHandler;
use MediaWiki\Hook\ParserAfterParseHook;
use MediaWiki\Hook\ParserFirstCallInitHook;
use MediaWiki\Hook\ParserTestGlobalsHook;
use Parser;
use StripState;

class Hooks implements
	ParserFirstCallInitHook,
	ParserAfterParseHook,
	ParserTestGlobalsHook
{

	/**
	 * ParserFirstCallInit hook handler
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/ParserFirstCallInit
	 * @param Parser $parser
	 */
	public function onParserFirstCallInit( $parser ) {
		global $wgKartographerEnableMapFrame;

		$parser->setHook( MapLink::TAG, [ MapLink::class, 'entryPoint' ] );
		if ( $wgKartographerEnableMapFrame ) {
			$parser->setHook( MapFrame::TAG, [ MapFrame::class, 'entryPoint' ] );
		}
	}

	/**
	 * ParserAfterParse hook handler
	 * @see https://www.mediawiki.org/wiki/Manual:Hooks/ParserAfterParse
	 * @param Parser $parser
	 * @param string &$text Text being parsed
	 * @param StripState $stripState StripState used
	 */
	public function onParserAfterParse( $parser, &$text, $stripState ) {
		$output = $parser->getOutput();
		$state = State::getState( $output );

		if ( $state ) {
			$options = $parser->getOptions();
			$isPreview = $options->getIsPreview() || $options->getIsSectionPreview();
			TagHandler::finalParseStep( $state, $output, $isPreview, $parser );
		}
	}

	/**
	 * @inheritDoc
	 */
	public function onParserTestGlobals( &$globals ) {
		$globals['wgKartographerMapServer'] = 'https://maps.wikimedia.org';
	}
}
