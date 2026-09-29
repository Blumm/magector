<?php
declare(strict_types=1);

namespace Acme\Ext\Plugin;

class OverridePlugin extends \Acme\Core\Plugin\BasePlugin
{
    public function afterSave($subject, $result)
    {
        return strtoupper($result);
    }
}
