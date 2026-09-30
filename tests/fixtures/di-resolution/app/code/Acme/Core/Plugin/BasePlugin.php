<?php
declare(strict_types=1);

namespace Acme\Core\Plugin;

class BasePlugin
{
    public function afterSave($subject, $result)
    {
        return $result;
    }
}
