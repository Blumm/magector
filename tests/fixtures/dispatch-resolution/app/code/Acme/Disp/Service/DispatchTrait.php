<?php
namespace Acme\Disp\Service;

/** E6: self:: in a trait method is the class that uses the trait */
trait DispatchTrait
{
    public function fire()
    {
        $this->eventManager->dispatch(self::EVENT . '_fired');
    }
}
