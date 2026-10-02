<?php
namespace Acme\Disp\Service;

/** E12: a multi-line call, a runtime value from the request */
class FrontLike
{
    protected $_eventManager;

    public function dispatchPre($request)
    {
        $this->_eventManager->dispatch(
            'acme_predispatch_' . $request->getFullActionName(),
            ['request' => $request]
        );
    }
}
