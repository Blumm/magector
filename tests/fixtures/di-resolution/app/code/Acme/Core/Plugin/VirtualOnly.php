<?php
declare(strict_types=1);

namespace Acme\Core\Plugin;

class VirtualOnly
{
    public function afterSave($subject, $result)
    {
        return $result;
    }
}
