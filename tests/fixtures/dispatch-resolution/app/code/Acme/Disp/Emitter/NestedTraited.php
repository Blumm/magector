<?php
namespace Acme\Disp\Emitter;

/** E5: the prefix from a trait used by a trait */
class NestedTraited extends Emitter
{
    use OuterTrait;
}
