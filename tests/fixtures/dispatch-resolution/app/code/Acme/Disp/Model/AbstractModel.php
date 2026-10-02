<?php
namespace Acme\Disp\Model;

/** E1/E2: a model base class — the dispatch site; the prefix comes from the class that runs it */
class AbstractModel
{
    protected $_eventPrefix = 'core_abstract';

    protected $_eventManager;

    public function afterSave()
    {
        $this->_eventManager->dispatch('acme_model_save_after', ['object' => $this]);
        $this->_eventManager->dispatch($this->_eventPrefix . '_save_after', ['object' => $this]);
        return $this;
    }
}
