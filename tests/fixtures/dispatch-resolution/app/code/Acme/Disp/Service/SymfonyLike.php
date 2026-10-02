<?php
namespace Acme\Disp\Service;

/** E18: not Magento's event manager — a name built at runtime here is not an event */
class SymfonyLike
{
    public $dispatcher;

    public function run($name)
    {
        $this->dispatcher->dispatch('acme_symfony_' . $name);
    }
}
