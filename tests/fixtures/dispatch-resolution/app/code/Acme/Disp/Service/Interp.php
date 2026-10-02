<?php
namespace Acme\Disp\Service;

/** E20: an interpolated string, and sprintf with a literal format */
class Interp
{
    protected $prefix = 'acme_interp';

    public $eventManager;

    public function run($aspect)
    {
        $this->eventManager->dispatch("{$this->prefix}_done");
        $this->eventManager->dispatch(sprintf('acme_copy_%s_%s', 'fieldset', $aspect));
    }
}
