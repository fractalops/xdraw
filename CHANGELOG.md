# Changelog

## [0.4.0](https://github.com/fractalops/xdraw/compare/v0.3.0...v0.4.0) (2026-08-22)


### ⚠ BREAKING CHANGES

* compile now returns a Promise, compileAsync is removed, and every property assignment requires '='.

### Features

* **cli:** report structured compilation measurements from check ([5c81c8b](https://github.com/fractalops/xdraw/commit/5c81c8b5ce63c90c77cc6128495c1237c3079de6))
* **language:** add measured geometry references and directed attachments ([6d0ca15](https://github.com/fractalops/xdraw/commit/6d0ca15b4686e95bf53be03b66a5330594cf536f))
* **layout:** solve relative placement and precision geometry as constraints ([31ad931](https://github.com/fractalops/xdraw/commit/31ad931a72d1202c3bea9147afbd943ad34ca850))
* **math:** add coordinate planes, inferred domains, and implicit plots ([3ff4930](https://github.com/fractalops/xdraw/commit/3ff493002c9a53965f40eb4245b64bb41333d829))


### Bug Fixes

* **routing:** reserve connector label space on emitted routes ([99828c8](https://github.com/fractalops/xdraw/commit/99828c871cf3d83d69a9a619dee3635fc89eeae2))
* say how a bound connector end follows its shape ([bbfa023](https://github.com/fractalops/xdraw/commit/bbfa023650a15a99fbf184e380cadd5d792ab1f2))


### Code Refactoring

* make compilation universally async and require explicit assignments ([ea8c2b1](https://github.com/fractalops/xdraw/commit/ea8c2b13a2d65f81e1feccd46340e247c0f2cb22))

## [0.3.0](https://github.com/fractalops/xdraw/compare/v0.2.0...v0.3.0) (2026-08-17)


### Features

* add a bounded expression sublanguage ([388d266](https://github.com/fractalops/xdraw/commit/388d2667568f0ea72844840feec06eec00048491))
* bring-to-front and send-to-back, borrowed from Excalidraw ([771452f](https://github.com/fractalops/xdraw/commit/771452fe07865517b5f2c6050ab772e506814a98))
* describe a curve when the document is read, draw it afterwards ([0899035](https://github.com/fractalops/xdraw/commit/089903525682ac1a57199d1f9cbc0b68e47ba74f))
* draw parametric curves with math.plot ([5109850](https://github.com/fractalops/xdraw/commit/51098508693c5dec25ccae82e81782c1c46980b1))
* let a kind declare its border, and meet a stroke on its own line ([bfc61fb](https://github.com/fractalops/xdraw/commit/bfc61fbe88fdd1ba4a3dccabc1461d0f179f6b06))
* let a stroke repeat, and a closed curve fill ([33ab5c9](https://github.com/fractalops/xdraw/commit/33ab5c93411194b37a90ed444f6727fe4ab1e0a2))
* name a number once with 'let' ([656fa39](https://github.com/fractalops/xdraw/commit/656fa398bc56095313cde9ca794a39c8280a266c))
* place a marker at a fraction along a drawn curve ([5e5fea0](https://github.com/fractalops/xdraw/commit/5e5fea045c1bfde4e0019b0b0bc9cc3c83d2407d))
* place text and freehand from another element's measured geometry ([f664546](https://github.com/fractalops/xdraw/commit/f664546462659e4bf81015cce722d884579ec0f6))
* read a plot's equations as equations and its domain as an interval ([d325d4d](https://github.com/fractalops/xdraw/commit/d325d4d060df043ffc6da8ee6ee30d90765122cb))
* repeat a declaration with each or count ([e1f5b78](https://github.com/fractalops/xdraw/commit/e1f5b782926711f1daf344b9c73d608fc871040d))
* sample curves by enclosure, so the tolerance is a guarantee ([e01f213](https://github.com/fractalops/xdraw/commit/e01f21391945c1506070ca14cdfcd280ffc140e3))
* suggest the intended name for mistyped constructors and arrangements ([c8314d3](https://github.com/fractalops/xdraw/commit/c8314d345b3419fc882831330395f3c33b05582b))


### Bug Fixes

* attach a straight connector where it crosses the border ([adcd406](https://github.com/fractalops/xdraw/commit/adcd4060c2d88af254f3f3fdd5adfffb78633cd2))
* do not suggest a constructor for a word that means something else ([a4cfb50](https://github.com/fractalops/xdraw/commit/a4cfb50702ba61baa0dcd1e85dc108a9c206206e))
* do not widen atan2 where its argument only reaches zero ([1d1cde6](https://github.com/fractalops/xdraw/commit/1d1cde65353961412b25e19d2d8b14c8d6764308))
* draw a node smaller than twice its padding ([19b742e](https://github.com/fractalops/xdraw/commit/19b742ea474829a5342b2c5b43f3a6fd71e21093))
* fold an expression whether or not the document has a binding ([fcda68a](https://github.com/fractalops/xdraw/commit/fcda68a4a9720ba4effdcfc114b868a63b8ce467))
* let a plot be placed from geometry, and a computed pair wrap ([e043b4a](https://github.com/fractalops/xdraw/commit/e043b4a4754dc635d72b0f94152d93a7844f9d6d))
* meet a diamond on its edge too, from one table ([780c5fb](https://github.com/fractalops/xdraw/commit/780c5fba34192260ab9ce8b66ae4c5ea37836425))
* meet an ellipse on its own outline, from one shared answer ([6ed9e50](https://github.com/fractalops/xdraw/commit/6ed9e50a191e8f758cfa0e88b8856bbc1791056e))
* say what went wrong after an '=' rather than what the parser saw ([8193c5d](https://github.com/fractalops/xdraw/commit/8193c5de07e178c79df51ee763649a21a1897e79))
* say when a label will not fit, and make a fill actually paint ([f50a8e2](https://github.com/fractalops/xdraw/commit/f50a8e2acfc380baf884deaa7d87d2005c91d657))
* stop refusing SVGs over the version attribute on their root ([e1f99a9](https://github.com/fractalops/xdraw/commit/e1f99a91ee83b931bb0509a24244462ae8491dbd))
* stop the typo property test failing on words it means to skip ([9ea4c6b](https://github.com/fractalops/xdraw/commit/9ea4c6b121a1160cd019b7cf5dc8ab2f676172c7))
* substitute a qualified instance name in a string too ([8b7152a](https://github.com/fractalops/xdraw/commit/8b7152a53fdc332ca7b9a31656adc115890a6925))

## [0.2.0](https://github.com/fractalops/xdraw/compare/v0.1.1...v0.2.0) (2026-08-15)


### Features

* expand XDraw language and rich content ([706b7e0](https://github.com/fractalops/xdraw/commit/706b7e064fc14f7346df6c10909616bcadd16cae))
* fan connectors that share an anchor ([9602258](https://github.com/fractalops/xdraw/commit/9602258a96028e84fd1d119e8804616843fd9c17))
* name the fix in unresolved name and property errors ([ece7082](https://github.com/fractalops/xdraw/commit/ece708282d9db3d3b0ec0b0efb8eaa498a5e1b5b))
* warn when a row will draw a crooked connector ([3034fcb](https://github.com/fractalops/xdraw/commit/3034fcb949fad0c5de8284d656b89bd03e9908ba))


### Bug Fixes

* cap the length of text the compiler must measure ([31e9067](https://github.com/fractalops/xdraw/commit/31e9067923f0b3f97ec1e0e7e78d565af41029bd))
* cover every measured string with the text limit ([08dc6a0](https://github.com/fractalops/xdraw/commit/08dc6a03382153ea004499cbf0275a3139c625c4))
* grow match-size targets to the largest ([1e9cea8](https://github.com/fractalops/xdraw/commit/1e9cea84990a5f6def33c2a082c5c161c24cd722))
* keep a shrunk word from breaking mid-word ([815bfd4](https://github.com/fractalops/xdraw/commit/815bfd425d3b1445c94e4abbbde26f74215a41fd))
* keep distribution from switching modes on a second pass ([df84bc0](https://github.com/fractalops/xdraw/commit/df84bc08b2e5ef57efd47d5ad96766864792dcb5))
* land the final distribution edge exactly ([5afff9c](https://github.com/fractalops/xdraw/commit/5afff9c977159a66f6f444846998df1ea41a68eb))
* make suggested fixes work when applied ([3134c0e](https://github.com/fractalops/xdraw/commit/3134c0e97f225e6214a313ff365fc42e065f04f3))
* raise the code and table font size ([c8def96](https://github.com/fractalops/xdraw/commit/c8def960c50fd5e8a011b835b6efe930f7fdabda))
* reject build output extensions that cannot be produced ([5b8c74b](https://github.com/fractalops/xdraw/commit/5b8c74b3a62d1efd92d8057b5b87aecd8299e7aa))
* reject over-nested documents with a syntax error ([5ba878f](https://github.com/fractalops/xdraw/commit/5ba878f8e1aebbfe0f748b08712c0581bb8d4c07))
* require a base URL that can protect the API key ([313f8b8](https://github.com/fractalops/xdraw/commit/313f8b84a2b6e4a9b670eb2ecd0a7a1c0b38b418))

## [0.1.1](https://github.com/fractalops/xdraw/compare/v0.1.0...v0.1.1) (2026-08-13)


### Bug Fixes

* prevent ambiguous scene patches ([c1f2135](https://github.com/fractalops/xdraw/commit/c1f21356bbdaf00f263a1586848eee71d7f61b6d))

## 0.1.0 (2026-08-13)


### Features

* add typed scene contracts and package build ([43d8baf](https://github.com/fractalops/xdraw/commit/43d8baf4ef704648ccf2c3c7011cb3572a89a606))
* add XDraw compiler and CLI ([892bf9d](https://github.com/fractalops/xdraw/commit/892bf9d3fcfa6f2bdae8102db7f12ebac2448ab7))
* prepare XDraw 0.1.0 ([652544a](https://github.com/fractalops/xdraw/commit/652544ac3e7055c33950189988f399310a450070))
* refine the XDraw language and drawing model ([5d61d80](https://github.com/fractalops/xdraw/commit/5d61d806d868bb4eb3cb331988e36e8f7edabbaf))


### Bug Fixes

* stabilize the initial release ([28ce45e](https://github.com/fractalops/xdraw/commit/28ce45e10fa36a80bbd39783d5d1c6a0637a4ba2))
