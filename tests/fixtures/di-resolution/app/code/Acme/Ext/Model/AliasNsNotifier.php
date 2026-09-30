<?php
declare(strict_types=1);

namespace Acme\Ext\Model;

use Acme\Core\Api as CoreApi;

/** Alias of a namespace, then a relative name through it. */
class AliasNsNotifier implements CoreApi\NotifierInterface
{
    public function notify(): void
    {
    }
}
