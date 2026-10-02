<?php
namespace Acme\Disp\Model;

/** F4: brings SilentTrait's afterSave() in through another trait */
trait OuterSilentTrait
{
    use SilentTrait;
}
