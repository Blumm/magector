<?php
declare(strict_types=1);

namespace Acme\Off\Plugin;

class OffPlugin
{
    public function afterSave($subject, $result)
    {
        return $result;
    }
}
